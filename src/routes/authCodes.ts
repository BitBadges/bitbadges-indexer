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
import { genericBlockinVerify, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { insertToDB, mustGetFromDB } from '../db/db';
import { BlockinAuthSignatureModel } from '../db/schemas';

export const createAuthCode = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCreateBlockinAuthCodeRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as CreateBlockinAuthCodeRouteRequestBody;

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

    await insertToDB(BlockinAuthSignatureModel, {
      _docId: reqBody.signature,
      ...reqBody,
      cosmosAddress: convertToCosmosAddress(challengeParams.address),
      params: challengeParams,
      createdAt: Date.now()
    });

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating QR auth code. Please try again later.'
    });
  }
};

export const getAuthCode = async (req: Request, res: Response<iGetBlockinAuthCodeRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetBlockinAuthCodeRouteRequestBody;

    // For now, we use the approach that if someone has the signature, they can see the message.
    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.signature);
    const params = doc.params;
    try {
      const verificationResponse = await genericBlockinVerify({
        message: createChallenge(params),
        signature: reqBody.signature,
        options: reqBody.options
      });
      if (!verificationResponse.success) {
        return res.status(200).send({
          message: createChallenge(params),
          params: params,
          verificationResponse: {
            success: false,
            errorMessage: verificationResponse.message
          }
        });
      }

      return res.status(200).send({
        message: createChallenge(params),
        params: params,
        verificationResponse: {
          success: verificationResponse.success
        }
      });
    } catch (e) {
      return res.status(200).send({
        params: params,
        message: createChallenge(params),
        verificationResponse: {
          success: false,
          errorMessage: e.message
        }
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting auth QR code. Please try again later.'
    });
  }
};

export const deleteAuthCode = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteBlockinAuthCodeRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as DeleteBlockinAuthCodeRouteRequestBody;

    const doc = await mustGetFromDB(BlockinAuthSignatureModel, reqBody.signature);
    if (doc.cosmosAddress !== req.session.cosmosAddress) {
      throw new Error('You are not the owner of this auth code.');
    }

    await insertToDB(BlockinAuthSignatureModel, {
      ...doc,
      deletedAt: Date.now()
    });

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting QR auth code. Please try again later.'
    });
  }
};
