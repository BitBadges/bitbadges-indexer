import {
  AttestationsProof,
  BlockinChallenge,
  BlockinChallengeParams,
  GetAndVerifySIWBBRequestsForDeveloperAppPayload,
  convertToCosmosAddress,
  getChainForAddress,
  iGetAndVerifySIWBBRequestsForDeveloperAppSuccessResponse,
  type CreateSIWBBRequestPayload,
  type DeleteSIWBBRequestPayload,
  type ErrorResponse,
  type GetAndVerifySIWBBRequestPayload,
  type NumberType,
  type iCreateSIWBBRequestSuccessResponse,
  type iDeleteSIWBBRequestSuccessResponse,
  type iGetAndVerifySIWBBRequestSuccessResponse
} from 'bitbadgesjs-sdk';
import { ChallengeParams, createChallenge } from 'blockin';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import {
  MaybeAuthenticatedRequest,
  checkIfAuthenticated,
  genericBlockinVerify,
  getAuthDetails,
  mustGetAuthDetails,
  setMockSessionIfTestMode,
  type AuthenticatedRequest
} from '../blockin/blockin_handlers';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { DeveloperAppModel, SIWBBRequestModel } from '../db/schemas';
import { typiaError } from './search';
import { executeSIWBBRequestsForAppQuery } from './userQueries';

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

    const origin = req.headers.origin;
    const authDetails = await mustGetAuthDetails(req, res);
    const isAuthenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Create Siwbb Requests' }]);
    if (!isAuthenticated) {
      throw new Error('You do not have permission to create Siwbb requests.');
    }

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

    //IMPORTANT: If we are calling from the frontend, we override the 'Create Siwbb Requests' scope in order to allow the user to not have to authenticate
    //           to the API. This is because it would be two signatures (one for creating the Siwbb request and one for signing in with BitBadges).
    //           We then use the fact that the Siwbb request signature is valid to confirm the user is who they say they are, rather than the req.session.
    //           This is checked in the middleware. However, if we are calling from the API, we do not override the scope.

    const isFromFrontend = origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io';
    if (!isFromFrontend) {
      if (reqPayload.redirectUri) {
        throw new Error('Creating Siwbb requests with a redirect URI is not supported for requests that interact with the API directly.');
      }
    }

    const toSkipSignatureVerification = true;
    const appDoc = await getFromDB(DeveloperAppModel, reqPayload.clientId);
    if (!appDoc) {
      throw new Error('Invalid client ID. All Siwbb requests must be associated with a valid client ID for an app.');
    }

    if (reqPayload.redirectUri && !appDoc.redirectUris.includes(reqPayload.redirectUri)) {
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
      clientId: reqPayload.clientId,
      otherSignIns: otherSignInsObj,
      redirectUri: reqPayload.redirectUri
    });

    return res.status(200).send({ code: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || e.message || 'Error creating QR Siwbb request.'
    });
  }
};

export const getSIWBBRequestsForDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetAndVerifySIWBBRequestsForDeveloperAppSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as unknown as GetAndVerifySIWBBRequestsForDeveloperAppPayload;
    const validateRes: typia.IValidation<GetAndVerifySIWBBRequestsForDeveloperAppPayload> =
      typia.validate<GetAndVerifySIWBBRequestsForDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const { clientId, bookmark } = reqPayload;
    const appDoc = await getFromDB(DeveloperAppModel, clientId);
    if (!appDoc) {
      throw new Error('Invalid client ID. All Siwbb requests must be associated with a valid client ID for an app.');
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
      errorMessage: e.message || 'Error getting Siwbb requests.'
    });
  }
};

export const getAndVerifySIWBBRequest = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iGetAndVerifySIWBBRequestSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    setMockSessionIfTestMode(req);
    const reqPayload = req.body as unknown as GetAndVerifySIWBBRequestPayload;
    const validateRes: typia.IValidation<GetAndVerifySIWBBRequestPayload> = typia.validate<GetAndVerifySIWBBRequestPayload>(req.body);
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

    const doc = await mustGetFromDB(SIWBBRequestModel, reqPayload.code);
    const { client_id, client_secret, redirect_uri, options: _options } = reqPayload;
    const clientId = client_id || headerClientId;
    const clientSecret = client_secret || headerClientSecret;
    const redirectUri = redirect_uri;
    const options = (_options || queryOptions) as GetAndVerifySIWBBRequestPayload['options'];

    // if (doc.ownershipRequirements && !options.ownershipRequirements) {
    //   throw new Error('This request has ownership requirements but expected ownership requirements were not specified.');
    // }

    // if (doc.otherSignIns && !options.otherSignIns) {
    //   throw new Error('This request has other sign ins but expected other sign ins were not specified.');
    // }

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
      assetOwnershipRequirements: options?.ownershipRequirements
    });

    console.log(doc.ownershipRequirements, options?.ownershipRequirements);

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

    const issuedAtTimeWindowMs = options?.issuedAtTimeWindowMs || 60 * 1000 * 10; //10 minutes

    if (issuedAtTimeWindowMs) {
      const earliestIssuedAt = Date.now() - issuedAtTimeWindowMs;
      if (doc.createdAt < earliestIssuedAt) {
        throw new Error('Not recent enough. Issued at time is too old: ' + new Date(Number(doc.createdAt)).toISOString());
      }
    }

    const authDetails = await getAuthDetails(req, res);
    if (!authDetails?.cosmosAddress || convertToCosmosAddress(doc.address) !== authDetails.cosmosAddress) {
      if (!clientId) {
        throw new Error('You are not the owner of this Siwbb request.');
      }

      const appDoc = await mustGetFromDB(DeveloperAppModel, clientId);
      if (!clientSecret || appDoc.clientSecret !== crypto.createHash('sha256').update(clientSecret).digest('hex')) {
        throw new Error('Invalid client secret.');
      }

      if (doc.clientId !== clientId) {
        throw new Error('Invalid client ID or redirect URI.');
      }

      if (doc.redirectUri) {
        if (!redirectUri) {
          throw new Error('Invalid redirect URI.');
        }

        if (doc.redirectUri !== redirectUri) {
          throw new Error('Invalid redirect URI.');
        }

        if (!appDoc.redirectUris.includes(redirectUri)) {
          throw new Error('Invalid redirect URI.');
        }
      }
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
        skipSignatureVerification: true
      }
    });

    const blockinRes = new BlockinChallenge({
      ...doc,
      verificationResponse
    });

    if (verificationResponse.success) {
      return res.status(200).send({ blockin: blockinRes, access_token: doc.address, token_type: 'Bearer' });
    } else {
      return res.status(401).send({ blockin: blockinRes, access_token: '', token_type: 'Bearer', errorMessage: verificationResponse.message });
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
      throw new Error('You are not the owner of this Siwbb request.');
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
      errorMessage: e.message || 'Error deleting QR Siwbb request.'
    });
  }
};
