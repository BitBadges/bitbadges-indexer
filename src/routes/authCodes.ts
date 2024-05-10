import {
  BlockinChallenge,
  Numberify,
  SecretsProof,
  convertToCosmosAddress,
  type CreateBlockinAuthCodeRouteRequestBody,
  type DeleteBlockinAuthCodeRouteRequestBody,
  type ErrorResponse,
  type GetBlockinAuthCodeRouteRequestBody,
  type NumberType,
  type iCreateBlockinAuthCodeRouteSuccessResponse,
  type iDeleteBlockinAuthCodeRouteSuccessResponse,
  type iGetBlockinAuthCodeRouteSuccessResponse,
  getChainForAddress
} from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, createChallenge } from 'blockin';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { MaybeAuthenticatedRequest, genericBlockinVerify, type AuthenticatedRequest, setMockSessionIfTestMode } from '../blockin/blockin_handlers';
import { insertToDB, mustGetFromDB } from '../db/db';
import { AuthAppModel, BlockinAuthSignatureModel } from '../db/schemas';

export const createAuthCode = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCreateBlockinAuthCodeRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as CreateBlockinAuthCodeRouteRequestBody;

    const appDoc = await mustGetFromDB(AuthAppModel, reqBody.clientId);
    if (reqBody.redirectUri && !appDoc.redirectUris.includes(reqBody.redirectUri)) {
      throw new Error('Invalid redirect URI.');
    }

    // Really all we want here is to verify signature is valid
    // Other stuff just needs to be valid at actual authentication time
    const challengeParams = constructChallengeObjectFromString<number>(reqBody.message, Numberify);

    if (!challengeParams.address || convertToCosmosAddress(challengeParams.address) !== req.session.cosmosAddress) {
      throw new Error('You can only add auth codes for the connected address.');
    }

    //Verifies from a cryptographic standpoint that the signature and secrets are valid
    const response = await genericBlockinVerify({
      message: reqBody.message,
      signature: reqBody.signature,
      publicKey: reqBody.publicKey,
      options: {
        skipTimestampVerification: true,
        skipAssetVerification: true
      },
      secretsProofs: reqBody.secretsProofs?.map((proof) => new SecretsProof(proof))
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
      options: reqBody.options,
      publicKey: reqBody.publicKey ?? '',
      cosmosAddress: convertToCosmosAddress(challengeParams.address),
      params: challengeParams,
      signature: reqBody.signature,
      createdAt: Date.now(),
      secretsProofs: reqBody.secretsProofs || [],
      clientId: reqBody.clientId,
      otherSignIns: otherSignInsObj,
      redirectUri: reqBody.redirectUri
    });

    if (reqBody.redirectUri) {
      return res.redirect(`${reqBody.redirectUri}?code=${uniqueId}&state=${reqBody.state}`);
    } else {
      return res.status(200).send({ code: uniqueId });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating QR auth code.'
    });
  }
};

export const getAuthCode = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response<iGetBlockinAuthCodeRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    setMockSessionIfTestMode(req);

    const reqBody = req.body as GetBlockinAuthCodeRouteRequestBody;

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
      options: doc.options
    });

    const blockinRes = new BlockinChallenge({
      ...doc,
      verificationResponse,
      options: doc.options,
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
      errorMessage: 'Error getting auth QR code.'
    });
  }
};

export const deleteAuthCode = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteBlockinAuthCodeRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as DeleteBlockinAuthCodeRouteRequestBody;

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
      errorMessage: 'Error deleting QR auth code.'
    });
  }
};
