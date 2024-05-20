import {
  BlockinChallenge,
  GetBlockinAuthCodesForAuthAppBody,
  Numberify,
  SecretsProof,
  convertToCosmosAddress,
  getChainForAddress,
  iGetBlockinAuthCodesForAuthAppSuccessResponse,
  type CreateBlockinAuthCodeBody,
  type DeleteBlockinAuthCodeBody,
  type ErrorResponse,
  type GetBlockinAuthCodeBody,
  type NumberType,
  type iCreateBlockinAuthCodeSuccessResponse,
  type iDeleteBlockinAuthCodeSuccessResponse,
  type iGetBlockinAuthCodeSuccessResponse
} from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, createChallenge } from 'blockin';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import {
  MaybeAuthenticatedRequest,
  checkIfAuthenticated,
  genericBlockinVerify,
  setMockSessionIfTestMode,
  type AuthenticatedRequest
} from '../blockin/blockin_handlers';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AuthAppModel, BlockinAuthSignatureModel } from '../db/schemas';
import { executeAuthCodesForAppQuery } from './userQueries';

export const createAuthCode = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iCreateBlockinAuthCodeSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as CreateBlockinAuthCodeBody;
    const challengeParams = constructChallengeObjectFromString<number>(reqBody.message, Numberify);
    if (!challengeParams.address) {
      throw new Error('Invalid address in message.');
    }

    //IMPORTANT: If we are calling from the frontend, we override the 'Create Auth Codes' scope in order to allow the user to not have to authenticate
    //           to the API. This is because it would be two signatures (one for creating the auth code and one for signing in with BitBadges).
    //           We then use the fact that the auth code signature is valid to confirm the user is who they say they are, rather than the req.session.
    //           This is checked in the middleware.
    const origin = req.headers.origin;
    const isFromFrontend =
      origin && (origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io');
    if (!isFromFrontend) {
      if (!checkIfAuthenticated(req, ['Create Auth Codes'])) {
        throw new Error('You do not have permission to create auth codes.');
      }

      if (reqBody.redirectUri) {
        throw new Error('Creating auth codes with a redirect URI is not supported for requests that interact with the API directly.');
      }

      if (!challengeParams.address || convertToCosmosAddress(challengeParams.address) !== req.session.cosmosAddress) {
        throw new Error('You can only add auth codes for the connected address.');
      }
    }

    const appDoc = await getFromDB(AuthAppModel, reqBody.clientId);
    if (!appDoc) {
      throw new Error('Invalid client ID. All auth codes must be associated with a valid client ID for an app.');
    }

    if (reqBody.redirectUri && !appDoc.redirectUris.includes(reqBody.redirectUri)) {
      throw new Error('Invalid redirect URI.');
    }

    //Really all we want here is to verify signature is valid
    //Other stuff just needs to be valid at actual authentication time
    //Verifies from a cryptographic standpoint that the signature and secrets are valid
    const response = await genericBlockinVerify({
      message: reqBody.message,
      signature: reqBody.signature,
      publicKey: reqBody.publicKey,
      options: {
        skipTimestampVerification: true,
        skipAssetVerification: true
      },
      secretsPresentations: reqBody.secretsPresentations?.map((proof) => new SecretsProof(proof))
    });

    if (!response?.success) {
      throw new Error('Signature was invalid: ' + response?.message);
    }

    const otherSignInsObj: Record<string, any> = {};
    for (const otherSignIn of reqBody.otherSignIns || []) {
      if (otherSignIn === 'discord') {
        if (!req.session.discord) {
          throw new Error('You must be signed in with Discord to add a Discord sign in.');
        }

        if (!req.session.discord.id || !req.session.discord.username) {
          throw new Error('Invalid Discord session data.');
        }

        otherSignInsObj.discord = {
          id: req.session.discord.id,
          username: req.session.discord.username,
          discriminator: req.session.discord.discriminator
        };
      } else if (otherSignIn === 'twitter') {
        if (!req.session.twitter) {
          throw new Error('You must be signed in with Twitter to add a Twitter sign in.');
        }

        if (!req.session.twitter.id || !req.session.twitter.username) {
          throw new Error('Invalid Twitter session data.');
        }

        otherSignInsObj.twitter = {
          id: req.session.twitter.id,
          username: req.session.twitter.username
        };
      } else if (otherSignIn === 'github') {
        if (!req.session.github) {
          throw new Error('You must be signed in with Github to add a Github sign in.');
        }

        if (!req.session.github.id || !req.session.github.username) {
          throw new Error('Invalid Github session data.');
        }

        otherSignInsObj.github = {
          id: req.session.github.id,
          username: req.session.github.username
        };
      } else if (otherSignIn === 'google') {
        if (!req.session.google) {
          throw new Error('You must be signed in with Google to add a Google sign in.');
        }

        if (!req.session.google.id || !req.session.google.username) {
          throw new Error('Invalid Google session data.');
        }

        otherSignInsObj.google = {
          id: req.session.google.id,
          username: req.session.google.username
        };
      }
    }

    const uniqueId = crypto.randomBytes(32).toString('hex');
    await insertToDB(BlockinAuthSignatureModel, {
      _docId: uniqueId,
      ...reqBody,
      publicKey: reqBody.publicKey ?? '',
      cosmosAddress: convertToCosmosAddress(challengeParams.address),
      params: challengeParams,
      signature: reqBody.signature,
      createdAt: Date.now(),
      secretsPresentations: reqBody.secretsPresentations || [],
      clientId: reqBody.clientId,
      otherSignIns: otherSignInsObj,
      redirectUri: reqBody.redirectUri
    });

    return res.status(200).send({ code: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || e.message || 'Error creating QR auth code.'
    });
  }
};

export const getAuthCodesForAuthApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetBlockinAuthCodesForAuthAppSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqBody = req.body as GetBlockinAuthCodesForAuthAppBody;
    const { clientId, bookmark } = reqBody;
    const appDoc = await getFromDB(AuthAppModel, clientId);
    if (!appDoc) {
      throw new Error('Invalid client ID. All auth codes must be associated with a valid client ID for an app.');
    }

    if (appDoc.createdBy !== req.session.cosmosAddress) {
      throw new Error('You are not the owner of this auth app.');
    }

    const docsRes = await executeAuthCodesForAppQuery(clientId, bookmark);
    return res.status(200).send({
      blockinAuthCodes: docsRes.docs.map((doc) => {
        const blockinRes = new BlockinChallenge({
          ...doc,
          address: doc.params.address,
          cosmosAddress: convertToCosmosAddress(doc.params.address),
          chain: getChainForAddress(doc.params.address),
          otherSignIns: doc.otherSignIns,
          message: createChallenge(doc.params)
        });

        return blockinRes;
      }),
      pagination: docsRes.pagination
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting auth codes.'
    });
  }
};

export const getAuthCode = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iGetBlockinAuthCodeSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    setMockSessionIfTestMode(req);

    const reqBody = req.body as GetBlockinAuthCodeBody;

    // For now, we use the approach that if someone has the signature, they can see the message.

    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.code);
    const { clientId, clientSecret, redirectUri } = reqBody;

    if (!req.session.cosmosAddress || convertToCosmosAddress(doc.params.address) !== req.session.cosmosAddress) {
      if (!clientId) {
        throw new Error('You are not the owner of this auth code.');
      }

      const appDoc = await mustGetFromDB(AuthAppModel, clientId);
      if (appDoc.clientSecret !== clientSecret) {
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

    const params = doc.params;

    const verificationResponse = await genericBlockinVerify({
      message: createChallenge(params),
      signature: doc.signature,
      publicKey: doc.publicKey,
      options: reqBody.options
    });

    const blockinRes = new BlockinChallenge({
      ...doc,
      verificationResponse,
      options: reqBody.options,
      address: params.address,
      cosmosAddress: convertToCosmosAddress(params.address),
      chain: getChainForAddress(params.address),
      otherSignIns: doc.otherSignIns,
      message: createChallenge(params)
    });

    return res.status(200).send({ blockin: blockinRes });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting auth QR code.'
    });
  }
};

export const deleteAuthCode = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteBlockinAuthCodeSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as DeleteBlockinAuthCodeBody;

    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.code);
    if (doc.cosmosAddress !== req.session.cosmosAddress) {
      throw new Error('You are not the owner of this auth code.');
    }

    await insertToDB(BlockinAuthSignatureModel, {
      ...doc,
      deletedAt: Date.now()
    });

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error deleting QR auth code.'
    });
  }
};
