import {
  Numberify,
  convertToCosmosAddress,
  type CreateBlockinAuthCodeRouteRequestBody,
  type DeleteBlockinAuthCodeRouteRequestBody,
  type ErrorResponse,
  type GetBlockinAuthCodeRouteRequestBody,
  type NumberType,
  type iCreateBlockinAuthCodeRouteSuccessResponse,
  type iDeleteBlockinAuthCodeRouteSuccessResponse,
  type iGetBlockinAuthCodeRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, createChallenge } from 'blockin';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, genericBlockinVerify, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { insertToDB, mustGetFromDB } from '../db/db';
import { BlockinAuthSignatureModel } from '../db/schemas';
import crypto from 'crypto';
import { verifySecretsProof } from './offChainSecrets';

export const createAuthCode = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCreateBlockinAuthCodeRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as CreateBlockinAuthCodeRouteRequestBody;

    for (const proof of reqBody.secretsProofs || []) {
      if (!checkIfAuthenticated(req, ['Secrets'])) {
        throw new Error('You must be authenticated to create a code w/ a secrets proof.');
      }

      await verifySecretsProof(req.session.address, proof, true);
    }

    // Really all we want here is to verify signature is valid
    // Other stuff just needs to be valid at actual authentication time
    const challengeParams = constructChallengeObjectFromString<number>(reqBody.message, Numberify);
    const response = await genericBlockinVerify({
      message: reqBody.message,
      signature: reqBody.signature,
      publicKey: reqBody.publicKey,
      options: {
        skipTimestampVerification: true,
        skipAssetVerification: true
      }
    });

    if (!response.success) {
      throw new Error('Signature was invalid: ' + response.message);
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
      secretsProofs: reqBody.secretsProofs || []
    });

    return res.status(200).send({ id: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating QR auth code.'
    });
  }
};

export const getAuthCode = async (req: Request, res: Response<iGetBlockinAuthCodeRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetBlockinAuthCodeRouteRequestBody;

    // For now, we use the approach that if someone has the signature, they can see the message.
    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.id);
    const params = doc.params;

    const verificationResponse = await genericBlockinVerify({
      message: createChallenge(params),
      signature: doc.signature,
      publicKey: doc.publicKey,
      options: reqBody.options
    });
    return res.status(200).send({
      secretsProofs: doc.secretsProofs,
      message: createChallenge(params),
      params,
      signature: doc.signature,
      cosmosAddress: convertToCosmosAddress(params.address),
      verificationResponse: {
        success: verificationResponse.success,
        errorMessage: verificationResponse.success ? '' : verificationResponse.message
      }
    });
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

    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.id);
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
