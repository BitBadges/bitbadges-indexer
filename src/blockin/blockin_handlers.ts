import axios from 'axios';
import {
  BalanceArray,
  BigIntify,
  CheckSignInStatusPayload,
  GenericVerifyAssetsPayload,
  OAuthScopeDetails,
  SupportedChain,
  convertToCosmosAddress,
  getChainForAddress,
  isAddressValid,
  mustConvertToCosmosAddress,
  verifyAttestationsPresentationSignatures,
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
import crypto from 'crypto';
import { type NextFunction, type Request, type Response } from 'express';
import { type Session } from 'express-session';
import { serializeError } from 'serialize-error';
import { generateNonce } from 'siwe';
import typia from 'typia';
import { twitterOauth } from '../auth/oauth';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AccessTokenModel, CollectionModel, ProfileModel } from '../db/schemas';
import { typiaError } from '../routes/search';
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
    refresh_token: string;
    expires_at: number;
  };
  /** Connected OAuth Twitter account. */
  twitter?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    access_token_secret: string;
  };
  /** Connected OAuth Github account. */
  github?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  /** Connected OAuth Google account. */
  google?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  twitch?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
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
    refresh_token: string;
    expires_at: number;
  };
  /** Connected OAuth Twitter account. */
  twitter?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    access_token_secret: string;
  };
  /** Connected OAuth Github account. */
  github?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  /** Connected OAuth Google account. */
  google?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  twitch?: {
    id: string;
    username: string;
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
}

export interface MaybeAuthenticatedRequest<T extends NumberType> extends Request {
  session: BlockinSession<T>;
}

export interface AuthenticatedRequest<T extends NumberType> extends Request {
  session: Required<BlockinSession<T>>;
}

export async function mustGetAuthDetails<T extends NumberType>(
  req: MaybeAuthenticatedRequest<T>,
  res: Response
): Promise<BlockinSession<T> & { blockin: string; blockinParams: ChallengeParams<T>; cosmosAddress: string; address: string }> {
  const authDetails = await getAuthDetails(req, res);
  if (!authDetails) {
    throw new Error('Not authenticated');
  }

  if (!authDetails.blockin || !authDetails.blockinParams || !authDetails.cosmosAddress || !authDetails.address) {
    throw new Error('Invalid auth details');
  }

  return authDetails as any;
}

export async function getAuthDetails<T extends NumberType>(
  req: MaybeAuthenticatedRequest<T> | { session: BlockinSession<T>; body: any; header?: never },
  res: Response
): Promise<(BlockinSessionDetails<T> & { scopes?: OAuthScopeDetails[] }) | null> {
  if (!req) {
    return null;
  }

  // Check Authorization header
  const authHeader = !req.header ? null : req.header('Authorization');
  if (authHeader == null) {
    if (req.session.blockin) {
      return {
        ...req.session,
        scopes:
          req.session.blockinParams?.resources?.map((x) => {
            return { scopeName: x.split(':')[0] };
          }) ?? []
      };
    }

    return req.session;
  } else {
    //Check cached value
    if (res && res.locals && res.locals.authDetails) {
      return res.locals.authDetails;
    }

    const authHeaderParts = authHeader.split(' ');
    if (authHeaderParts.length !== 2) {
      throw new Error('Invalid Authorization header');
    }

    const token = authHeaderParts[1];
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenDoc = await getFromDB(AccessTokenModel, tokenHash);
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
      resources: tokenDoc.scopes.map((x) => SupportedScopes.find((scope) => scope.startsWith(x.scopeName + ':')) ?? []) as string[]
    };

    //Save to cache
    res.locals.authDetails = {
      address: tokenDoc.address,
      cosmosAddress: tokenDoc.cosmosAddress,
      blockin: createChallenge(defaultChallengeParams),
      blockinParams: defaultChallengeParams,
      nonce: '*',
      scopes: tokenDoc.scopes
    };

    return {
      address: tokenDoc.address,
      cosmosAddress: tokenDoc.cosmosAddress,
      blockin: createChallenge(defaultChallengeParams),
      blockinParams: defaultChallengeParams,
      nonce: '*',
      scopes: tokenDoc.scopes
    };
  }
}

export async function checkIfAuthenticated(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  expectedScopes: OAuthScopeDetails[]
): Promise<boolean> {
  setMockSessionIfTestMode(req);

  const authDetails = await getAuthDetails(req, res);
  if (!req || authDetails == null) {
    return false;
  }

  const hasCorrectScopes = await hasScopes(req, res, expectedScopes);
  if (!hasCorrectScopes) {
    return false;
  } else {
    return true;
  }

  // // Nonce should not be checked in case you are prompting a new sign-in (we generate and verify the new sign-in with req.sesssion.nonce)
  // return Boolean(
  //   authDetails?.blockin &&
  //     authDetails?.blockinParams &&
  //     authDetails?.cosmosAddress &&
  //     authDetails?.address &&
  //     authDetails?.blockinParams?.address === authDetails?.address
  // );
}

export async function checkIfManager(req: MaybeAuthenticatedRequest<NumberType>, res: Response, collectionId: NumberType): Promise<boolean> {
  const authDetails = await getAuthDetails(req, res);
  if (!authDetails) return false;

  // Should we account for if the indexer is out of sync / catching up and managerTimeline is potentially different now?
  // I don't think it is that big of a deal. 1) Important stuff is already on the blockchain and 2) they have to be a prev manager

  const collection = await mustGetFromDB(CollectionModel, collectionId.toString());
  const manager = collection.getManager();

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
    const validateRes: typia.IValidation<GetSignInChallengePayload> = typia.validate<GetSignInChallengePayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

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
      resources: [`Full Access: Full access to all features.`],
      assetOwnershipRequirements: {
        assets: [
          {
            collectionId: 1,
            chain: 'BitBadges',
            assetIds: [{ start: 9, end: 9 }],
            ownershipTimes: [],
            mustOwnAmounts: { start: 0, end: 0 }
          }
        ]
      }
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

export async function validateAccessTokens(req: MaybeAuthenticatedRequest<NumberType>) {
  if (req.session.discord && Date.now() > req.session.discord.expires_at - 1000 * 60 * 5) {
    // 5 minutes before expiry
    // const accessToken = req.session.discord.access_token;
    const refreshToken = req.session.discord.refresh_token;
    try {
      const res = await axios.post(
        'https://discord.com/api/oauth2/token',
        new URLSearchParams({
          client_id: process.env.CLIENT_ID ?? '',
          client_secret: process.env.CLIENT_SECRET ?? '',
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          redirect_uri:
            process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/discord/callback' : 'https://api.bitbadges.io/auth/discord/callback'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      if (!res.data.access_token || !res.data.refresh_token) {
        req.session.discord = undefined;
      } else {
        req.session.discord.access_token = res.data.access_token;
        req.session.discord.refresh_token = res.data.refresh_token;
        req.session.discord.expires_at = Date.now() + res.data.expires_in * 1000;
      }
    } catch (err) {
      console.error(err);
      req.session.discord = undefined;
    }
  }

  //TODO: This is never going to run because Github doesnt return refresh tokens
  if (req.session.github && Date.now() > req.session.github.expires_at - 1000 * 60 * 5) {
    // if (req.session.github) {
    // const accessToken = req.session.github.access_token;
    const refreshToken = req.session.github.refresh_token;
    try {
      //Refresh
      const res = await axios.post('https://github.com/login/oauth/access_token', {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      if (!res.data.access_token || !res.data.refresh_token) {
        req.session.github = undefined;
      } else {
        req.session.github.access_token = res.data.access_token;
        req.session.github.refresh_token = res.data.refresh_token;
        req.session.github.expires_at = Date.now() + res.data.expires_in * 1000;
      }
    } catch (err) {
      req.session.github = undefined;
    }
  }

  if (req.session.twitch && Date.now() > req.session.twitch.expires_at - 1000 * 60 * 5) {
    // if (req.session.twitch) {    // const accessToken = req.session.twitch.access_token;
    const refreshToken = req.session.twitch.refresh_token;
    try {
      //Refresh
      const res = await axios.post('https://id.twitch.tv/oauth2/token', {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      if (!res.data.access_token || !res.data.refresh_token) {
        req.session.twitch = undefined;
      } else {
        req.session.twitch.access_token = res.data.access_token;
        req.session.twitch.refresh_token = res.data.refresh_token;
        req.session.twitch.expires_at = Date.now() + res.data.expires_in * 1000;
      }
    } catch (err) {
      console.log(err);
      req.session.twitch = undefined;
    }
  }

  if (req.session.google && Date.now() > req.session.google.expires_at - 1000 * 60 * 5) {
    // const accessToken = req.session.google.access_token;
    const refreshToken = req.session.google.refresh_token;
    try {
      //Refresh
      const res = await axios.post('https://oauth2.googleapis.com/token?access_type=offline&prompt=consent', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      if (!res.data.access_token) {
        req.session.google = undefined;
      } else {
        req.session.google.access_token = res.data.access_token;
        req.session.google.expires_at = Date.now() + res.data.expires_in * 1000;
      }
    } catch (err) {
      console.error(err);
      req.session.google = undefined;
    }
  }

  //Dont think this wil ever run because Twitter doesnt explicitly give refresh tokens or expire access tokens
  if (req.session.twitter && Date.now() > req.session.twitter.expires_at - 1000 * 60 * 5) {
    //Test if access token is currently valid
    const accessToken = req.session.twitter.access_token;
    const accessTokenSecret = req.session.twitter.access_token_secret;
    try {
      const userProfileUrl = 'https://api.twitter.com/1.1/account/verify_credentials.json';
      await new Promise((resolve, reject) => {
        twitterOauth.get(userProfileUrl, accessToken, accessTokenSecret, (error, data) => {
          if (error) {
            return reject(error);
          }
          resolve(data);
        });
      });
    } catch (err) {
      console.log(err);
      req.session.twitter = undefined;
    }
  }

  req.session.save();
}

export async function checkifSignedInHandler(req: MaybeAuthenticatedRequest<NumberType>, res: Response<iCheckSignInStatusSuccessResponse>) {
  const authDetails = await getAuthDetails(req, res);

  const body = req.body as CheckSignInStatusPayload;
  if (body.validateAccessTokens) {
    await validateAccessTokens(req);
  }

  return res.status(200).send({
    signedIn: !!authDetails?.blockin,
    scopes: authDetails?.scopes ?? [],
    message: authDetails?.blockin ?? '',
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
    },
    twitch: {
      id: req.session.twitch?.id ?? '',
      username: req.session.twitch?.username ?? ''
    }
  });
}

export async function removeBlockinSessionCookie(req: MaybeAuthenticatedRequest<NumberType>, res: Response<iSignOutSuccessResponse>) {
  const body = req.body as SignOutPayload;
  const validateRes: typia.IValidation<SignOutPayload> = typia.validate<SignOutPayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

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

  if (body.signOutTwitch ?? false) {
    session.twitch = undefined;
  }

  if (
    session.address == null &&
    session.discord == null &&
    session.twitter == null &&
    session.github == null &&
    session.google == null &&
    session.twitch == null
  ) {
    try {
      session.destroy((err) => {
        if (err) {
          console.log(err);
        }
      });
    } catch (err) {
      console.log(err);
      return res.status(500).json({ success: false, errorMessage: 'Error signing out.' });
    }
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
  const validateRes: typia.IValidation<VerifySignInPayload> = typia.validate<VerifySignInPayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

  try {
    setMockSessionIfTestMode(req);

    const generatedEIP4361ChallengeStr = body.message;
    const challenge = constructChallengeObjectFromString(generatedEIP4361ChallengeStr, BigIntify);
    const chain = getChainForAddress(challenge.address);
    const chainDriver = getChainDriver(chain);

    const useWeb2SignIn = !body.signature;
    if (useWeb2SignIn) {
      const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(challenge.address));
      await validateAccessTokens(req);

      let approved = false;
      const entries = Object.entries(profileDoc.approvedSignInMethods ?? {});
      for (const [key, value] of entries) {
        const sessionDetails = req.session[key as 'discord' | 'twitter' | 'github' | 'google' | 'twitch'];
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

            challenge.resources = scopes.map((x) => SupportedScopes.find((scope) => scope.startsWith(x.scopeName + ':')) ?? []) as string[];
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
          // setMockSessionIfTestMode(req);

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
    req.session.blockin = createChallenge(challenge);
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
  req.session.twitch = mockSession.twitch;
  req.session.save();
}

export function authorizeBlockinRequest(expectedScopes: OAuthScopeDetails[]) {
  return async (req: MaybeAuthenticatedRequest<NumberType>, res: Response<ErrorResponse>, next: NextFunction) => {
    try {
      setMockSessionIfTestMode(req);

      const isAuthenticated = await checkIfAuthenticated(req, res, expectedScopes);
      if (isAuthenticated) {
        if (expectedScopes?.length) {
          const hasCorrectScopes = await hasScopes(req, res, expectedScopes);
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
      for (const proof of body.attestationsPresentations ?? []) {
        await verifyAttestationsPresentationSignatures(proof, true);
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
  const validateRes: typia.IValidation<VerifySignInPayload> = typia.validate<VerifySignInPayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

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
  const validateRes: typia.IValidation<GenericVerifyAssetsPayload> = typia.validate<GenericVerifyAssetsPayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

  try {
    mustConvertToCosmosAddress(body.address);

    const dummyChallengeParams: ChallengeParams<NumberType> = {
      domain: 'https://bitbadges.io',
      statement,
      address: body.address,
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
      return res.status(200).json({ success: false, errorMessage: `${verificationResponse.message} ` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ errorMessage: `${err.message} ` });
  }
}
