import {
  AttestationsProof,
  BlockinChallenge,
  BlockinChallengeParams,
  GetSIWBBRequestsForDeveloperAppPayload,
  RotateSIWBBRequestPayload,
  convertToCosmosAddress,
  getChainForAddress,
  iAccessTokenDoc,
  iGetSIWBBRequestsForDeveloperAppSuccessResponse,
  iRotateSIWBBRequestSuccessResponse,
  iSIWBBRequestDoc,
  mustConvertToCosmosAddress,
  type CreateSIWBBRequestPayload,
  type DeleteSIWBBRequestPayload,
  type ErrorResponse,
  type ExchangeSIWBBAuthorizationCodePayload,
  type NumberType,
  type iCreateSIWBBRequestSuccessResponse,
  type iDeleteSIWBBRequestSuccessResponse,
  type iExchangeSIWBBAuthorizationCodeSuccessResponse
} from 'bitbadgesjs-sdk';
import { ChallengeParams, createChallenge } from 'blockin';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import validator from 'validator';
import {
  MaybeAuthenticatedRequest,
  checkIfAuthenticated,
  genericBlockinVerify,
  getAuthDetails,
  mustGetAuthDetails,
  setMockSessionIfTestMode,
  validateAccessTokens,
  type AuthenticatedRequest
} from '../blockin/blockin_handlers';
import { deleteMany, getFromDB, insertMany, insertToDB, mustGetFromDB, mustGetManyFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AccessTokenModel, AuthorizationCodeModel, DeveloperAppModel, SIWBBRequestModel } from '../db/schemas';
import { typiaError } from './search';
import { executeSIWBBRequestsForAppQuery } from './userQueries';

export const rotateSIWBBRequest = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iRotateSIWBBRequestSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as RotateSIWBBRequestPayload;
    const validateRes: typia.IValidation<RotateSIWBBRequestPayload> = typia.validate<RotateSIWBBRequestPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const isAuthenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Approve Sign In with BitBadges Requests' }]);
    if (!isAuthenticated) {
      throw new Error('You do not have permission to create requests.');
    }
    const authDetails = await mustGetAuthDetails(req, res);
    const doc = await mustGetFromDB(SIWBBRequestModel, reqPayload.code);
    if (doc.cosmosAddress !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this SIWBB request.');
    }

    const newDoc: iSIWBBRequestDoc<bigint> = {
      ...doc,
      _id: undefined,
      _docId: crypto.randomBytes(32).toString('hex')
    };

    //TODO: sessionize
    await insertMany(SIWBBRequestModel, [
      newDoc,
      {
        ...doc,
        deletedAt: Date.now()
      }
    ]);

    return res.status(200).send({ code: newDoc._docId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error rotating QR SIWBB request.'
    });
  }
};

export const createSIWBBRequest = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iCreateSIWBBRequestSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as CreateSIWBBRequestPayload;
    const validateRes: typia.IValidation<CreateSIWBBRequestPayload> = typia.validate<CreateSIWBBRequestPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const { response_type, redirect_uri, scopes } = req.body as CreateSIWBBRequestPayload;

    if (response_type !== 'code') {
      throw new Error('Invalid response type. Only "code" is supported.');
    }

    if (scopes.find((scope) => scope.scopeName === 'Full Access')) {
      throw new Error('Full Access scope is not allowed for API Authorization.');
    }

    if (scopes.length > 0 && !redirect_uri) {
      throw new Error('Redirect URI is required for API authorization with scopes.');
    }

    const origin = req.headers.origin;

    const isAuthenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Approve Sign In with BitBadges Requests' }]);
    if (!isAuthenticated) {
      throw new Error('You do not have permission to create requests.');
    }
    const authDetails = await mustGetAuthDetails(req, res);

    //Dummy params for compatibility
    const ownershipRequirements = reqPayload.ownershipRequirements;
    const challengeParams: ChallengeParams<NumberType> = {
      domain: 'https://bitbadges.io',
      statement: 'Something something something',
      address: authDetails.address,
      uri: 'https://bitbadges.io',
      nonce: '*',
      expirationDate: undefined,
      notBefore: undefined,
      resources: [],
      assetOwnershipRequirements: ownershipRequirements
    };

    if (!challengeParams.address) {
      throw new Error('Invalid address in message.');
    }

    const isFromFrontend = origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io';
    if (!isFromFrontend) {
      if (reqPayload.redirect_uri) {
        throw new Error('Creating SIWBB requests with a redirect URI is not supported for requests that interact with the API directly.');
      }
    }

    const toSkipSignatureVerification = true;
    const appDoc = await getFromDB(DeveloperAppModel, reqPayload.client_id);
    if (!appDoc) {
      throw new Error('Invalid client ID. All SIWBB requests must be associated with a valid client ID for an app.');
    }

    if (reqPayload.redirect_uri && !appDoc.redirectUris.includes(reqPayload.redirect_uri)) {
      throw new Error('Invalid redirect URI.');
    }

    //Really all we want here is to verify well formed
    //Other stuff just needs to be valid at actual authentication time
    //Verifies from a cryptographic standpoint that all is valid
    const response = await genericBlockinVerify({
      message: createChallenge(challengeParams),
      signature: '',
      options: {
        skipTimestampVerification: true,
        skipAssetVerification: true,
        skipSignatureVerification: toSkipSignatureVerification
      },
      attestationsPresentations: reqPayload.attestationsPresentations?.map((proof) => new AttestationsProof(proof))
    });
    if (!response?.success) {
      throw new Error('Verification was invalid: ' + response?.message);
    }

    const otherSignInsObj: Record<string, any> = {};
    if (reqPayload.otherSignIns?.length) {
      await validateAccessTokens(req);
    }

    for (const otherSignIn of reqPayload.otherSignIns || []) {
      const authDetails = await mustGetAuthDetails(req, res);
      if (otherSignIn === 'discord') {
        if (!authDetails.discord) {
          throw new Error('You must be signed in with Discord to add a Discord sign in.');
        }

        if (!authDetails.discord?.id || !authDetails.discord?.username) {
          throw new Error('Invalid Discord session data.');
        }

        otherSignInsObj.discord = {
          id: authDetails.discord?.id,
          username: authDetails.discord?.username,
          discriminator: authDetails.discord?.discriminator
        };
      } else if (otherSignIn === 'twitter') {
        if (!authDetails.twitter) {
          throw new Error('You must be signed in with Twitter to add a Twitter sign in.');
        }

        if (!authDetails.twitter?.id || !authDetails.twitter?.username) {
          throw new Error('Invalid Twitter session data.');
        }

        otherSignInsObj.twitter = {
          id: authDetails.twitter?.id,
          username: authDetails.twitter?.username
        };
      } else if (otherSignIn === 'github') {
        if (!authDetails.github) {
          throw new Error('You must be signed in with Github to add a Github sign in.');
        }

        if (!authDetails.github?.id || !authDetails.github?.username) {
          throw new Error('Invalid Github session data.');
        }

        otherSignInsObj.github = {
          id: authDetails.github?.id,
          username: authDetails.github?.username
        };
      } else if (otherSignIn === 'google') {
        if (!authDetails.google) {
          throw new Error('You must be signed in with Google to add a Google sign in.');
        }

        if (!authDetails.google?.id || !authDetails.google?.username) {
          throw new Error('Invalid Google session data.');
        }

        otherSignInsObj.google = {
          id: authDetails.google?.id,
          username: authDetails.google?.username
        };
      }
    }

    const uniqueId = crypto.randomBytes(32).toString('hex');
    await insertToDB(SIWBBRequestModel, {
      _docId: uniqueId,
      ...reqPayload,
      address: authDetails.address,
      chain: getChainForAddress(authDetails.address),
      ownershipRequirements: reqPayload.ownershipRequirements,
      cosmosAddress: convertToCosmosAddress(challengeParams.address),
      createdAt: Date.now(),
      attestationsPresentations: reqPayload.attestationsPresentations || [],
      clientId: reqPayload.client_id,
      otherSignIns: otherSignInsObj,
      redirectUri: reqPayload.redirect_uri,
      scopes: scopes,
      expiresAt: scopes.length > 0 || redirect_uri ? Date.now() + 1000 * 60 * 10 : 0 //10 minutes
    });

    return res.status(200).send({ code: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || e.message || 'Error creating QR SIWBB request.'
    });
  }
};

export const getSIWBBRequestsForDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetSIWBBRequestsForDeveloperAppSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as unknown as GetSIWBBRequestsForDeveloperAppPayload;
    const validateRes: typia.IValidation<GetSIWBBRequestsForDeveloperAppPayload> = typia.validate<GetSIWBBRequestsForDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const { clientId, bookmark } = reqPayload;
    const appDoc = await getFromDB(DeveloperAppModel, clientId);
    if (!appDoc) {
      throw new Error('Invalid client ID. All SIWBB requests must be associated with a valid client ID for an app.');
    }

    const authDetails = await mustGetAuthDetails(req, res);
    if (appDoc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this app.');
    }

    //TODO: Allow proof of client secret?

    const docsRes = await executeSIWBBRequestsForAppQuery(clientId, bookmark);
    return res.status(200).send({
      siwbbRequests: docsRes.docs.map((doc) => {
        const blockinRes = new BlockinChallenge({
          ...doc
        });

        return blockinRes;
      }),
      pagination: docsRes.pagination
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting SIWBB requests.'
    });
  }
};

export const exchangeSIWBBAuthorizationCode = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iExchangeSIWBBAuthorizationCodeSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    setMockSessionIfTestMode(req);
    const reqPayload = req.body as unknown as ExchangeSIWBBAuthorizationCodePayload;
    const validateRes: typia.IValidation<ExchangeSIWBBAuthorizationCodePayload> = typia.validate<ExchangeSIWBBAuthorizationCodePayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }
    // For now, we use the approach that if someone has the signature, they can see the message.

    const authHeader = req.headers.authorization;
    const authHeaderParts = authHeader?.split(' ');
    const authHeaderType = authHeaderParts?.[0];
    let headerClientId = '';
    let headerClientSecret = '';

    //next auth (auth.js) compatibility
    if (authHeaderType === 'Basic') {
      const authHeaderToken = authHeaderParts?.[1];
      const authHeaderTokenPayloadDecoded = Buffer.from(authHeaderToken || '', 'base64').toString('utf-8');

      const authHeaderTokenPayloadDecodedObj = authHeaderTokenPayloadDecoded.split(':');
      headerClientId = authHeaderTokenPayloadDecodedObj[0];
      headerClientSecret = authHeaderTokenPayloadDecodedObj[1];
    }

    const queryOptions = {};
    try {
      if (req.query.options) {
        Object.assign(queryOptions, JSON.parse(req.query.options as string));
      }
    } catch (e) {
      console.error(e);
    }

    const { client_id, client_secret, redirect_uri, options: _options } = reqPayload;
    const clientId = client_id || headerClientId;
    const clientSecret = client_secret || headerClientSecret;
    const redirectUri = redirect_uri;
    const options = (_options || queryOptions) as ExchangeSIWBBAuthorizationCodePayload['options'];

    const authDetails = await getAuthDetails(req, res);
    const verifyDevAppDetails = async (
      expected: { clientId: string; clientSecret: string; redirectUris: string[]; address: string },
      actual: { clientId: string; clientSecret: string; redirectUri?: string }
    ) => {
      if (mustConvertToCosmosAddress(expected.address) !== authDetails?.cosmosAddress) {
        if (!clientId) {
          throw new Error('You are not the owner of this SIWBB request.');
        }

        if (!clientSecret || expected.clientSecret !== crypto.createHash('sha256').update(clientSecret).digest('hex')) {
          throw new Error('Invalid client secret.');
        }

        if (actual.clientId !== clientId) {
          throw new Error('Invalid client ID or redirect URI.');
        }

        if (actual.redirectUri) {
          if (!redirectUri) {
            throw new Error('Invalid redirect URI.');
          }

          if (actual.redirectUri !== redirectUri) {
            throw new Error('Invalid redirect URI.');
          }

          if (!expected.redirectUris.includes(redirectUri)) {
            throw new Error('Invalid redirect URI.');
          }
        }
      }
    };

    const { grant_type, refresh_token } = req.body as unknown as ExchangeSIWBBAuthorizationCodePayload;

    let accessTokenToReturn = '';
    let refreshTokenToReturn = undefined;
    if (grant_type === 'authorization_code') {
      if (!reqPayload.code) {
        throw new Error('Invalid code.');
      }

      const appDoc = await mustGetFromDB(DeveloperAppModel, clientId);
      await verifyDevAppDetails(
        {
          clientId: clientId,
          clientSecret: appDoc.clientSecret,
          redirectUris: appDoc.redirectUris,
          address: appDoc.createdBy
        },
        {
          clientId: clientId,
          clientSecret: clientSecret,
          redirectUri: redirectUri
        }
      );

      const doc = await mustGetFromDB(SIWBBRequestModel, reqPayload.code);
      const newChallengeParams: BlockinChallengeParams<NumberType> = new BlockinChallengeParams({
        domain: 'https://bitbadges.io',
        statement: 'Something something something',
        address: doc.address,
        uri: 'https://bitbadges.io',
        nonce: '*',
        expirationDate: undefined,
        notBefore: undefined,
        resources: [],
        assetOwnershipRequirements: doc.ownershipRequirements
      });

      const optionsChallengeParams: BlockinChallengeParams<NumberType> = new BlockinChallengeParams({
        ...newChallengeParams,
        assetOwnershipRequirements: options?.skipAssetVerification ? undefined : options?.ownershipRequirements
      });

      if (options?.ownershipRequirements && !newChallengeParams.equals(optionsChallengeParams, true)) {
        throw new Error('Invalid ownership requirements. Does not match expected ownership requirements.');
      }

      if (options?.otherSignIns) {
        for (const social of options?.otherSignIns) {
          if (!doc.otherSignIns?.[social]) {
            throw new Error('Invalid other sign in. Does not match expected other sign in.');
          }
        }
      }

      const issuedAtTimeWindowMs = options?.issuedAtTimeWindowMs ?? 60 * 1000 * 10; //10 minutes

      if (issuedAtTimeWindowMs) {
        const earliestIssuedAt = Date.now() - issuedAtTimeWindowMs;
        if (doc.createdAt < earliestIssuedAt) {
          throw new Error('Not recent enough. Issued at time is too old: ' + new Date(Number(doc.createdAt)).toISOString());
        }
      }

      if (doc.expiresAt && doc.expiresAt < Date.now()) {
        throw new Error('Expired.');
      }

      const dummyParams = {
        domain: 'https://bitbadges.io',
        statement: 'Something',
        address: doc.address,
        uri: 'https://bitbadges.io',
        nonce: '*',
        expirationDate: undefined,
        notBefore: undefined,
        resources: [],
        assetOwnershipRequirements: doc.ownershipRequirements
      };

      const verificationResponse = await genericBlockinVerify({
        message: createChallenge(dummyParams),
        signature: '',
        options: {
          skipSignatureVerification: true,
          skipAssetVerification: options?.skipAssetVerification
        }
      });

      const blockinRes = new BlockinChallenge({
        ...doc,
        verificationResponse
      });

      if (doc.scopes.length > 0) {
        const accessToken = crypto.randomBytes(32).toString('hex');
        const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');

        const refreshToken = crypto.randomBytes(32).toString('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const token: iAccessTokenDoc = {
          _docId: accessTokenHash,
          accessToken: accessTokenHash,
          tokenType: 'bearer',
          accessTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24,
          refreshToken: refreshTokenHash,
          refreshTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,

          cosmosAddress: mustConvertToCosmosAddress(doc.address),
          address: doc.address,
          clientId: doc.clientId,
          scopes: doc.scopes
        };

        await insertToDB(AccessTokenModel, token);
        await deleteMany(AuthorizationCodeModel, [reqPayload.code]);

        accessTokenToReturn = accessToken;
        refreshTokenToReturn = refreshToken;
      } else {
        //For non-scope based SIWBB, we simply return the address
        accessTokenToReturn = doc.address;
      }

      if (verificationResponse.success) {
        return res.status(200).send({
          ...blockinRes,
          access_token: accessTokenToReturn,
          refresh_token_expires_at: refreshTokenToReturn ? Date.now() + 1000 * 60 * 60 * 24 * 30 : undefined,
          access_token_expires_at: accessTokenToReturn ? Date.now() + 1000 * 60 * 60 * 24 : undefined,
          refresh_token: refreshTokenToReturn,
          token_type: 'Bearer'
        });
      } else {
        return res.status(401).send({ ...blockinRes, access_token: '', token_type: 'Bearer', errorMessage: verificationResponse.message });
      }
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        throw new Error('Invalid refresh token');
      }

      if (!validator.isHexadecimal(refresh_token)) {
        throw new Error('Invalid refresh token.');
      }

      const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
      const refreshTokenRes = await findInDB(AccessTokenModel, { query: { refreshToken: { $eq: refreshTokenHash } } });
      if (refreshTokenRes.length === 0) {
        throw new Error('Invalid refresh token.');
      }
      const accessTokenDoc = refreshTokenRes[0];
      const refreshTokenDoc = refreshTokenRes[0];

      if (refreshTokenDoc.refreshTokenExpiresAt < Date.now()) {
        throw new Error('Refresh token expired.');
      }

      const doc = await mustGetFromDB(DeveloperAppModel, accessTokenDoc.clientId);
      await verifyDevAppDetails(
        {
          clientId: accessTokenDoc.clientId,
          clientSecret: doc.clientSecret,
          redirectUris: doc.redirectUris,
          address: doc.createdBy
        },
        {
          clientId: clientId,
          clientSecret: clientSecret,
          redirectUri: redirectUri
        }
      );

      const newAccessToken = crypto.randomBytes(32).toString('hex');
      const newAccessTokenHash = crypto.createHash('sha256').update(newAccessToken).digest('hex');

      const newRefreshToken = crypto.randomBytes(32).toString('hex');
      const newRefreshTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

      const newToken: iAccessTokenDoc = {
        _docId: newAccessTokenHash,
        accessToken: newAccessTokenHash,
        tokenType: 'bearer',
        accessTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24,
        refreshTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24 * 60,
        refreshToken: newRefreshTokenHash,
        cosmosAddress: refreshTokenDoc.cosmosAddress,
        address: refreshTokenDoc.address,
        scopes: refreshTokenDoc.scopes,
        clientId: refreshTokenDoc.clientId
      };
      await insertToDB(AccessTokenModel, newToken);
      await deleteMany(AccessTokenModel, [refreshTokenDoc._docId]);

      return res.status(200).send({
        address: accessTokenDoc.address,
        cosmosAddress: mustConvertToCosmosAddress(accessTokenDoc.address),
        chain: getChainForAddress(accessTokenDoc.address),
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        access_token_expires_at: Date.now() + 1000 * 60 * 60 * 24,
        refresh_token_expires_at: Date.now() + 1000 * 60 * 60 * 24 * 60
      });
    } else {
      throw new Error('Invalid grant type.');
    }
  } catch (e) {
    console.error(e);
    console.log(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting auth QR code.'
    });
  }
};

export const deleteSIWBBRequest = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteSIWBBRequestSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as DeleteSIWBBRequestPayload;
    const validateRes: typia.IValidation<DeleteSIWBBRequestPayload> = typia.validate<DeleteSIWBBRequestPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }
    const authDetails = await mustGetAuthDetails(req, res);
    const doc = await mustGetFromDB(SIWBBRequestModel, reqPayload.code);
    if (doc.cosmosAddress !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this SIWBB request.');
    }

    await insertToDB(SIWBBRequestModel, {
      ...doc,
      deletedAt: Date.now()
    });

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error deleting QR SIWBB request.'
    });
  }
};

export async function revokeSiwbbHandler(req: AuthenticatedRequest<NumberType>, res: Response) {
  try {
    const { token } = req.body;
    typia.assert<string>(token);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const accessTokenDoc = await mustGetFromDB(AccessTokenModel, tokenHash);
    await deleteMany(AccessTokenModel, [accessTokenDoc._docId]);
    return res.status(200).send({ message: 'Token revoked' });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
}

export async function getSiwbbAuthorizations(req: AuthenticatedRequest<NumberType>, res: Response) {
  try {
    const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;
    const docs = await findInDB(AccessTokenModel, { query: { cosmosAddress } });
    const clientIds = docs.map((doc) => doc.clientId);
    const developerApps = await mustGetManyFromDB(DeveloperAppModel, clientIds);

    return res.status(200).json({
      authorizations: docs,
      developerApps: developerApps.map((x) => {
        return { ...x, clientSecret: undefined };
      })
    });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
}