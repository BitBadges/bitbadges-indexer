import {
  BalanceArray,
  BigIntify,
  SignOutRequestBody,
  SupportedChain,
  convertToCosmosAddress,
  getChainForAddress,
  isAddressValid,
  type ErrorResponse,
  type GenericBlockinVerifyRouteRequestBody,
  type GetSignInChallengeRouteRequestBody,
  type NumberType,
  type VerifySignInRouteRequestBody,
  type iCheckSignInStatusRequestSuccessResponse,
  type iGetSignInChallengeRouteSuccessResponse,
  type iSignOutSuccessResponse,
  type iVerifySignInRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, createChallenge, verifyChallenge, type ChallengeParams } from 'blockin';
import { type NextFunction, type Request, type Response } from 'express';
import { type Session } from 'express-session';
import { serializeError } from 'serialize-error';
import { generateNonce } from 'siwe';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { CollectionModel, ProfileModel } from '../db/schemas';
import { getChainDriver } from './blockin';
import { hasScopes } from './scopes';

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

export function checkIfAuthenticated(req: MaybeAuthenticatedRequest<NumberType>, expectedScopes?: string[]) {
  if (expectedScopes) {
    if (!hasScopes(req, expectedScopes)) {
      return false;
    }
  }

  // Nonce should not be checked in case you are prompting a new sign-in (we generate and verify the new sign-in with req.sesssion.nonce)
  return (
    req.session.blockin &&
    req.session.blockinParams &&
    req.session.cosmosAddress &&
    req.session.address &&
    req.session.blockinParams.address === req.session.address
  );
}

export async function checkIfManager(req: MaybeAuthenticatedRequest<NumberType>, collectionId: NumberType) {
  if (!checkIfAuthenticated(req)) return false;

  // Should we account for if the indexer is out of sync / catching up and managerTimeline is potentially different now?
  // I don't think it is that big of a deal. 1) Important stuff is already on the blockchain and 2) they have to be a prev manager

  const collection = await mustGetFromDB(CollectionModel, collectionId.toString());
  const manager = collection.getManager();

  if (!manager) return false;
  if (manager !== req.session.cosmosAddress) return false;
  return true;
}

export function returnUnauthorized(res: Response<ErrorResponse>, managerRoute: boolean = false) {
  return res.status(401).json({
    errorMessage: `Unauthorized. You must be signed in ${managerRoute ? 'and the manager of the collection' : 'to access this feature'}.`,
    unauthorized: true
  });
}

export const statement =
  'Sign this message only if prompted by a trusted party. The signature of this message can be used to authenticate you on BitBadges. By signing, you agree to the BitBadges privacy policy and terms of service.';
export async function getChallenge(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iGetSignInChallengeRouteSuccessResponse<NumberType> | ErrorResponse>
) {
  try {
    const reqBody = req.body as GetSignInChallengeRouteRequestBody;

    if (!isAddressValid(reqBody.address)) {
      return res.status(400).json({ errorMessage: 'Invalid address' });
    }

    req.session.nonce = generateNonce();
    req.session.save();

    const hours = reqBody.hours ? Math.floor(Number(reqBody.hours)) : 168 * 2;
    if (isNaN(hours)) {
      return res.status(400).json({ errorMessage: 'Invalid hours' });
    }

    // Get the current time
    const iso8601 = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const challengeParams = {
      domain: 'https://bitbadges.io',
      statement,
      address: reqBody.address,
      uri: 'https://bitbadges.io',
      nonce: req.session.nonce ?? '',
      expirationDate: iso8601,
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
      errorMessage: 'Error creating challenge.'
    });
  }
}

export async function checkifSignedInHandler(req: MaybeAuthenticatedRequest<NumberType>, res: Response<iCheckSignInStatusRequestSuccessResponse>) {
  return res.status(200).send({
    signedIn: !!checkIfAuthenticated(req),
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
  const body = req.body as SignOutRequestBody;

  const session = req.session;
  if (body.signOutBlockin) {
    session.address = undefined;
    session.cosmosAddress = undefined;
    session.blockin = undefined;
    session.blockinParams = undefined;
    session.nonce = undefined;
    session.cookie.expires = new Date(Date.now() - 1000);
  }

  if (body.signOutDiscord) {
    session.discord = undefined;
  }

  if (body.signOutTwitter) {
    session.twitter = undefined;
  }

  if (body.signOutGithub) {
    session.github = undefined;
  }

  if (body.signOutGoogle) {
    session.google = undefined;
  }

  req.session.save();

  return res.status(200).send({ errorMessage: 'Successfully removed session cookie!' });
}

export async function verifyBlockinAndGrantSessionCookie(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iVerifySignInRouteSuccessResponse | ErrorResponse>
) {
  const body = req.body as VerifySignInRouteRequestBody;

  try {
    const generatedEIP4361ChallengeStr = body.message;
    const challenge = constructChallengeObjectFromString(generatedEIP4361ChallengeStr, BigIntify);
    const chain = getChainForAddress(challenge.address);
    const chainDriver = getChainDriver(chain);

    const useWeb2SignIn = !body.signature;
    if (useWeb2SignIn) {
      const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(challenge.address));
      const discordSignInMethod = profileDoc.approvedSignInMethods?.discord;

      if (!discordSignInMethod || !req.session.discord) {
        return res
          .status(401)
          .json({ success: false, errorMessage: 'You did not provide a valid signature and did not meet any of the other sign-in methods.' });
      }

      const { id, username, discriminator } = req.session.discord;

      if (!id || !username || !discriminator) {
        return res
          .status(401)
          .json({ success: false, errorMessage: 'You did not provide a valid signature and did not meet any of the other sign-in methods.' });
      }

      if (
        discordSignInMethod.id !== id ||
        discordSignInMethod.username !== username ||
        (discordSignInMethod.discriminator && Number(discordSignInMethod.discriminator) !== Number(discriminator))
      ) {
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
    if (challenge.expirationDate) {
      req.session.cookie.expires = new Date(challenge.expirationDate);
    }
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

export function authorizeBlockinRequest(expectedScopes?: string[]) {
  return (req: MaybeAuthenticatedRequest<NumberType>, res: Response<ErrorResponse>, next: NextFunction) => {
    if (process.env.TEST_MODE === 'true') {
      const mockSessionJson = req.header('x-mock-session');
      if (mockSessionJson) {
        const mockSession = JSON.parse(mockSessionJson);
        req.session.address = mockSession.address;
        req.session.cosmosAddress = mockSession.cosmosAddress;
        req.session.blockin = mockSession.blockin;
        req.session.blockinParams = mockSession.blockinParams;
        req.session.nonce = mockSession.nonce;
        req.session.save();
        if (expectedScopes?.length) {
          if (!hasScopes(req, expectedScopes)) {
            return returnUnauthorized(res);
          }
        }

        next();
        return;
      }
    }

    if (checkIfAuthenticated(req)) {
      if (expectedScopes?.length) {
        if (!hasScopes(req, expectedScopes)) {
          return returnUnauthorized(res);
        }
      }
      next();
      return;
    }

    return returnUnauthorized(res);
  };
}

export async function genericBlockinVerify(body: GenericBlockinVerifyRouteRequestBody) {
  if (body.options?.beforeVerification) {
    throw new Error('You cannot use the beforeVerification option over HTTP.');
  }

  if (body.options?.balancesSnapshot) {
    for (const key in body.options.balancesSnapshot) {
      for (const key2 in (body.options.balancesSnapshot as any)[key]) {
        (body.options.balancesSnapshot as any)[key][key2] = BalanceArray.From((body.options.balancesSnapshot as any)[key][key2]);
      }
    }
  }

  const chain = getChainForAddress(constructChallengeObjectFromString(body.message, BigIntify).address);
  const chainDriver = getChainDriver(chain);
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

  return verificationResponse;
}

export async function genericBlockinVerifyHandler(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iVerifySignInRouteSuccessResponse | ErrorResponse>
) {
  const body = req.body as VerifySignInRouteRequestBody;

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
