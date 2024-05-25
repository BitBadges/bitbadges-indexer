import {
  BalanceArray,
  BigIntify,
  GenericVerifyAssetsPayload,
  SupportedChain,
  convertToCosmosAddress,
  getChainForAddress,
  isAddressValid,
  verifySecretsPresentationSignatures,
  type ErrorResponse,
  type GenericBlockinVerifyPayload,
  type GetSignInChallengePayload,
  type NumberType,
  type SignOutPayload,
  type VerifySignInPayload,
  type iCheckSignInStatusSuccessResponse,
  type iGetSignInChallengeSuccessResponse,
  type iSignOutSuccessResponse,
  type iVerifySignInSuccessResponse
} from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, createChallenge, verifyChallenge, type ChallengeParams } from 'blockin';
import { type NextFunction, type Request, type Response } from 'express';
import { type Session } from 'express-session';
import { serializeError } from 'serialize-error';
import { generateNonce } from 'siwe';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AccessTokenModel, CollectionModel, ProfileModel } from '../db/schemas';
import { getChainDriver } from './blockin';
import { SupportedScopes, hasScopes } from './scopes';

export interface BlockinSessionDetails<T extends NumberType> {
  /**
   * Nonce that is used to prevent replay attacks. The following sign-in must be signed with this nonce.
   *
   * Note this may be inconsistent from blockinParams.nonce which is for the current sign-in details. This nonce is for the next sign-in.
   */
  nonce?: string;
  /** Stringified Blockin message that was signed. */
  blockin?: string;
  /** Blockin params that were signed. */
  blockinParams?: ChallengeParams<T>;
  /** Cosmos address of the user. Equal to convertToCosmosAddress(blockinParams.address). */
  cosmosAddress?: string;
  /** Native chain address of the user. Equal to blockinParams.address. */
  address?: string;
  /** Connected OAuth Discord account. */
  discord?: {
    id: string;
    username: string;
    discriminator: string;
    access_token: string;
  };
  /** Connected OAuth Twitter account. */
  twitter?: {
    id: string;
    username: string;
    access_token: string;
    access_token_secret: string;
  };
  /** Connected OAuth Github account. */
  github?: {
    id: string;
    username: string;
  };
  /** Connected OAuth Google account. */
  google?: {
    id: string;
    username: string;
  };
  /** Connected OAuth Reddit account. */
  reddit?: {
    id: string;
    username: string;
  };
}

export interface BlockinSession<T extends NumberType> extends Session {
  /**
   * Nonce that is used to prevent replay attacks. The following sign-in must be signed with this nonce.
   *
   * Note this may be inconsistent from blockinParams.nonce which is for the current sign-in details. This nonce is for the next sign-in.
   */
  nonce?: string;
  /** Stringified Blockin message that was signed. */
  blockin?: string;
  /** Blockin params that were signed. */
  blockinParams?: ChallengeParams<T>;
  /** Cosmos address of the user. Equal to convertToCosmosAddress(blockinParams.address). */
  cosmosAddress?: string;
  /** Native chain address of the user. Equal to blockinParams.address. */
  address?: string;
  /** Connected OAuth Discord account. */
  discord?: {
    id: string;
    username: string;
    discriminator: string;
    access_token: string;
  };
  /** Connected OAuth Twitter account. */
  twitter?: {
    id: string;
    username: string;
    access_token: string;
    access_token_secret: string;
  };
  /** Connected OAuth Github account. */
  github?: {
    id: string;
    username: string;
  };
  /** Connected OAuth Google account. */
  google?: {
    id: string;
    username: string;
  };
  /** Connected OAuth Reddit account. */
  reddit?: {
    id: string;
    username: string;
  };
}

export interface MaybeAuthenticatedRequest<T extends NumberType> extends Request {
  session: BlockinSession<T>;
}

export interface AuthenticatedRequest<T extends NumberType> extends Request {
  session: Required<BlockinSession<T>>;
}

export async function mustGetAuthDetails<T extends NumberType>(
  req: MaybeAuthenticatedRequest<T>
): Promise<BlockinSession<T> & { blockin: string; blockinParams: ChallengeParams<T>; cosmosAddress: string; address: string }> {
  const authDetails = await getAuthDetails(req);
  if (!authDetails) {
    throw new Error('Not authenticated');
  }

  if (!authDetails.blockin || !authDetails.blockinParams || !authDetails.cosmosAddress || !authDetails.address) {
    throw new Error('Invalid auth details');
  }

  return authDetails as any;
}

export async function getAuthDetails<T extends NumberType>(
  req: MaybeAuthenticatedRequest<T> | { session: BlockinSession<T>; body: any; header?: never }
): Promise<BlockinSessionDetails<T> | null> {
  if (!req) {
    return null;
  }

  // Check Authorization header
  const authHeader = !req.header ? null : req.header('Authorization');
  if (authHeader == null) {
    return req.session;
  } else {
    const authHeaderParts = authHeader.split(' ');
    if (authHeaderParts.length !== 2) {
      throw new Error('Invalid Authorization header');
    }

    const token = authHeaderParts[1];
    const tokenDoc = await getFromDB(AccessTokenModel, token);
    if (!tokenDoc || tokenDoc.accessTokenExpiresAt < Date.now()) {
      return null;
    }

    const defaultChallengeParams: ChallengeParams<T> = {
      domain: 'https://bitbadges.io',
      statement,
      address: tokenDoc.address,
      uri: 'https://bitbadges.io',
      nonce: '*',
      expirationDate: undefined,
      notBefore: undefined,
      resources: tokenDoc.scopes.map((x) => SupportedScopes.find((scope) => scope.startsWith(x + ':')) ?? []) as string[]
    };

    return {
      address: tokenDoc.address,
      cosmosAddress: tokenDoc.cosmosAddress,
      blockin: createChallenge(defaultChallengeParams),
      blockinParams: defaultChallengeParams,
      nonce: '*'
    };
  }
}

export async function checkIfAuthenticated(req: MaybeAuthenticatedRequest<NumberType>, expectedScopes?: string[]): Promise<boolean> {
  setMockSessionIfTestMode(req);

  const authDetails = await getAuthDetails(req);

  if (!req || authDetails == null) {
    return false;
  }

  if (expectedScopes != null) {
    const hasCorrectScopes = await hasScopes(req, expectedScopes);
    if (!hasCorrectScopes) {
      return false;
    }
  }

  // Nonce should not be checked in case you are prompting a new sign-in (we generate and verify the new sign-in with req.sesssion.nonce)
  return Boolean(
    authDetails?.blockin &&
      authDetails?.blockinParams &&
      authDetails?.cosmosAddress &&
      authDetails?.address &&
      authDetails?.blockinParams?.address === authDetails?.address
  );
}

export async function checkIfManager(req: MaybeAuthenticatedRequest<NumberType>, collectionId: NumberType): Promise<boolean> {
  const isAuthenticated = await checkIfAuthenticated(req);
  if (!isAuthenticated) return false;

  // Should we account for if the indexer is out of sync / catching up and managerTimeline is potentially different now?
  // I don't think it is that big of a deal. 1) Important stuff is already on the blockchain and 2) they have to be a prev manager

  const collection = await mustGetFromDB(CollectionModel, collectionId.toString());
  const manager = collection.getManager();

  const authDetails = await mustGetAuthDetails(req);
  if (!manager) return false;
  if (manager !== authDetails.cosmosAddress) return false;
  return true;
}

export function returnUnauthorized(res: Response<ErrorResponse>, managerRoute: boolean = false) {
  return res.status(401).json({
    errorMessage: `Unauthorized. You must be signed in with the correct scopes ${managerRoute ? 'and the manager of the collection' : 'to access this feature'}.`,
    unauthorized: true
  });
}

export const statement =
  'Sign this message only if prompted by a trusted party. The signature of this message can be used to authenticate you on BitBadges. By signing, you agree to the BitBadges privacy policy and terms of service.';

export async function getChallenge(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iGetSignInChallengeSuccessResponse<NumberType> | ErrorResponse>
) {
  try {
    const reqPayload = req.body as unknown as GetSignInChallengePayload;

    if (!isAddressValid(reqPayload.address)) {
      return res.status(400).json({ errorMessage: 'Invalid address' });
    }

    req.session.nonce = generateNonce();
    req.session.save();

    const challengeParams = {
      domain: 'https://bitbadges.io',
      statement,
      address: reqPayload.address,
      uri: 'https://bitbadges.io',
      nonce: req.session.nonce ?? '',
      expirationDate: undefined,
      notBefore: undefined,
      resources: [],
      assets: []
    };

    const blockinMessage = createChallenge(challengeParams);
    return res.status(200).json({
      nonce: req.session.nonce ?? '',
      params: challengeParams,
      message: blockinMessage
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: serializeError(err),
      errorMessage: err.message || 'Error creating challenge.'
    });
  }
}

export async function checkifSignedInHandler(req: MaybeAuthenticatedRequest<NumberType>, res: Response<iCheckSignInStatusSuccessResponse>) {
  return res.status(200).send({
    signedIn: !!(await checkIfAuthenticated(req)),
    message: req.session.blockin ?? '',
    discord: {
      id: req.session.discord?.id ?? '',
      username: req.session.discord?.username ?? '',
      discriminator: req.session.discord?.discriminator ?? ''
    },
    twitter: {
      id: req.session.twitter?.id ?? '',
      username: req.session.twitter?.username ?? ''
    },
    github: {
      id: req.session.github?.id ?? '',
      username: req.session.github?.username ?? ''
    },
    google: {
      id: req.session.google?.id ?? '',
      username: req.session.google?.username ?? ''
    }
  });
}

export async function removeBlockinSessionCookie(req: MaybeAuthenticatedRequest<NumberType>, res: Response<iSignOutSuccessResponse>) {
  const body = req.body as SignOutPayload;

  const session = req.session;
  if (body.signOutBlockin) {
    session.address = undefined;
    session.cosmosAddress = undefined;
    session.blockin = undefined;
    session.blockinParams = undefined;
    session.nonce = undefined;
  }

  if (body.signOutDiscord ?? false) {
    session.discord = undefined;
  }

  if (body.signOutTwitter ?? false) {
    session.twitter = undefined;
  }

  if (body.signOutGithub ?? false) {
    session.github = undefined;
  }

  if (body.signOutGoogle ?? false) {
    session.google = undefined;
  }

  if (session.address == null && session.discord == null && session.twitter == null && session.github == null && session.google == null) {
    session.destroy((err) => {
      if (err) {
        console.error(err);
      }
    });
  } else {
    req.session.save();
  }

  return res.status(200).send();
}

export async function verifyBlockinAndGrantSessionCookie(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iVerifySignInSuccessResponse | ErrorResponse>
) {
  const body = req.body as VerifySignInPayload;

  try {
    setMockSessionIfTestMode(req);

    const generatedEIP4361ChallengeStr = body.message;
    const challenge = constructChallengeObjectFromString(generatedEIP4361ChallengeStr, BigIntify);
    const chain = getChainForAddress(challenge.address);
    const chainDriver = getChainDriver(chain);

    const useWeb2SignIn = !body.signature;
    if (useWeb2SignIn) {
      const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(challenge.address));

      let approved = false;
      const entries = Object.entries(profileDoc.approvedSignInMethods ?? {});
      for (const [key, value] of entries) {
        const sessionDetails = req.session[key as 'discord' | 'twitter' | 'github' | 'google' | 'reddit'];
        if (sessionDetails) {
          let discriminator: string | undefined = undefined;
          const { id, username } = sessionDetails;
          if (key === 'discord') {
            discriminator = (sessionDetails as any).discriminator;
          }

          if (!id || !username) continue;
          if (key === 'discord' && (value as any).discriminator && Number((value as any).discriminator) !== Number(discriminator)) {
            continue;
          }

          if (value.id === id && value.username === username) {
            approved = true;
            const scopes = value.scopes ?? [];
            if (!scopes.length) {
              throw new Error('No scopes found for this sign-in method.');
            }

            challenge.resources = scopes.map((x) => SupportedScopes.find((scope) => scope.startsWith(x + ':')) ?? []) as string[];
            body.message = createChallenge(challenge);
            break;
          }
        }
      }

      if (!approved) {
        return res
          .status(401)
          .json({ success: false, errorMessage: 'You did not provide a valid signature and did not meet any of the other sign-in methods.' });
      }
    }

    const verificationResponse = await verifyChallenge(
      chainDriver,
      body.message,
      body.signature ?? '',
      {
        expectedChallengeParams: {
          domain: 'https://bitbadges.io',
          uri: 'https://bitbadges.io',
          statement
        },
        beforeVerification: async (challengeParams) => {
          if (process.env.TEST_MODE === 'true') return;

          if (!req.session.nonce) {
            await Promise.reject(new Error('No nonce found in session. Please try again.'));
            return;
          }

          if (challengeParams.nonce !== req.session.nonce) {
            await Promise.reject(new Error(`Invalid nonce. Expected ${req.session.nonce}, got ${challengeParams.nonce}`));
          }
        },
        skipSignatureVerification: useWeb2SignIn
      },
      body.publicKey
    );
    if (!verificationResponse.success) {
      return res.status(401).json({ success: false, errorMessage: `${verificationResponse.message} ` });
    }

    req.session.address = challenge.address;
    req.session.cosmosAddress = convertToCosmosAddress(challenge.address);
    req.session.blockinParams = challenge;
    req.session.blockin = generatedEIP4361ChallengeStr;
    req.session.save();

    // Set up a profile if first time or update details if necessary based on sign-in
    // We add the latestSignedInChain and also if the user is signing in with Solana, we add the solAddress
    const profileDoc = await getFromDB(ProfileModel, req.session.cosmosAddress);
    if (
      !profileDoc ||
      (profileDoc && profileDoc.latestSignedInChain !== chain) ||
      (getChainForAddress(challenge.address) === SupportedChain.SOLANA && !profileDoc.solAddress)
    ) {
      await insertToDB(ProfileModel, {
        ...profileDoc,
        createdAt: profileDoc?.createdAt ?? Date.now(),
        _docId: req.session.cosmosAddress,
        latestSignedInChain: chain,
        solAddress: getChainForAddress(challenge.address) === SupportedChain.SOLANA ? challenge.address : profileDoc?.solAddress
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.log(err);
    return res.status(401).json({ success: false, errorMessage: `${err.message} ` });
  }
}

export function setMockSessionIfTestMode(req: MaybeAuthenticatedRequest<NumberType>): void {
  if (process.env.TEST_MODE !== 'true') return;

  const mockSessionJson = req.header('x-mock-session');
  if (mockSessionJson == null || mockSessionJson === '') return;

  const mockSession = JSON.parse(mockSessionJson);

  req.session.address = mockSession.address;
  req.session.cosmosAddress = mockSession.cosmosAddress;
  req.session.blockin = mockSession.blockin;
  req.session.blockinParams = mockSession.blockinParams;
  req.session.nonce = mockSession.nonce;
  req.session.discord = mockSession.discord;
  req.session.twitter = mockSession.twitter;
  req.session.github = mockSession.github;
  req.session.google = mockSession.google;
  req.session.reddit = mockSession.reddit;
  req.session.save();
}

export function authorizeBlockinRequest(expectedScopes: string[]) {
  return async (req: MaybeAuthenticatedRequest<NumberType>, res: Response<ErrorResponse>, next: NextFunction) => {
    try {
      setMockSessionIfTestMode(req);

      const isAuthenticated = await checkIfAuthenticated(req, expectedScopes);
      if (isAuthenticated) {
        if (expectedScopes?.length) {
          const hasCorrectScopes = await hasScopes(req, expectedScopes);
          if (!hasCorrectScopes) {
            return returnUnauthorized(res);
          }
        }
        next();
        return;
      }

      return returnUnauthorized(res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: serializeError(err),
        errorMessage: err.message || 'Error authorizing request.'
      });
    }
  };
}

export async function genericBlockinVerify(body: GenericBlockinVerifyPayload) {
  if (body.options?.beforeVerification != null) {
    throw new Error('You cannot use the beforeVerification option over HTTP.');
  }

  if (body.options?.balancesSnapshot != null) {
    for (const key in body.options.balancesSnapshot) {
      for (const key2 in (body.options.balancesSnapshot as any)[key]) {
        (body.options.balancesSnapshot as any)[key][key2] = BalanceArray.From((body.options.balancesSnapshot as any)[key][key2]);
      }
    }
  }

  const address = constructChallengeObjectFromString(body.message, BigIntify).address;
  const chain = getChainForAddress(address);
  const chainDriver = getChainDriver(chain);
  try {
    const verificationResponse = await verifyChallenge(
      chainDriver,
      body.message,
      body.signature,
      {
        ...body.options,
        balancesSnapshot: body.options?.balancesSnapshot,
        beforeVerification: undefined
      },
      body.publicKey
    );
    if (verificationResponse.success) {
      for (const proof of body.secretsPresentations ?? []) {
        await verifySecretsPresentationSignatures(proof, true);
      }

      return verificationResponse;
    } else {
      return verificationResponse;
    }
  } catch (err) {
    console.error(err);
    return {
      success: false,
      message: err.message
    };
  }
}

export async function genericBlockinVerifyHandler(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iVerifySignInSuccessResponse | ErrorResponse>
) {
  const body = req.body as unknown as VerifySignInPayload;

  try {
    const verificationResponse = await genericBlockinVerify(body);

    if (!verificationResponse.success) {
      return res.status(401).json({ success: false, errorMessage: `${verificationResponse.message} ` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ success: false, errorMessage: `${err.message} ` });
  }
}

export async function genericBlockinVerifyAssetsHandler(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iVerifySignInSuccessResponse | ErrorResponse>
) {
  const body = req.body as unknown as GenericVerifyAssetsPayload;

  try {
    const cosmosAddress = convertToCosmosAddress(body.cosmosAddress);

    const dummyChallengeParams: ChallengeParams<NumberType> = {
      domain: 'https://bitbadges.io',
      statement,
      address: cosmosAddress,
      uri: 'https://bitbadges.io',
      nonce: '*',
      expirationDate: undefined,
      notBefore: undefined,
      resources: [],
      assetOwnershipRequirements: body.assetOwnershipRequirements
    };

    const verificationResponse = await genericBlockinVerify({
      message: createChallenge(dummyChallengeParams),
      signature: '',
      options: { skipSignatureVerification: true, skipTimestampVerification: true }
    });

    if (!verificationResponse.success) {
      return res.status(401).json({ success: false, errorMessage: `${verificationResponse.message} ` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ success: false, errorMessage: `${err.message} ` });
  }
}
