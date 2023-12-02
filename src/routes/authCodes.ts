import { NumberType, Stringify } from "bitbadgesjs-proto";
import { CreateBlockinAuthCodeRouteRequestBody, CreateBlockinAuthCodeRouteResponse, DeleteBlockinAuthCodeRouteRequestBody, DeleteBlockinAuthCodeRouteResponse, GetBlockinAuthCodeRouteRequestBody, GetBlockinAuthCodeRouteResponse, convertToCosmosAddress, getChainForAddress, } from "bitbadgesjs-utils";
import { constructChallengeObjectFromString, constructChallengeStringFromChallengeObject } from "blockin";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, genericBlockinVerify } from "../blockin/blockin_handlers";
import { AUTH_CODES_DB, insertToDB } from "../db/db";
import { catch404 } from "../utils/couchdb-utils";

export const createAuthCode = async (expressReq: Request, res: Response<CreateBlockinAuthCodeRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as CreateBlockinAuthCodeRouteRequestBody;

    const challengeParams = constructChallengeObjectFromString(reqBody.message, Stringify);

    if (!reqBody.signature) {
      throw new Error("Signature is required.");
    }

    if (!reqBody.message) {
      throw new Error("Message is required.");
    }

    //Really all we want here is to verify signature is valid
    //Other stuff just needs to be valid at actual auth time
    const response = await genericBlockinVerify(
      {
        message: reqBody.message,
        signature: reqBody.signature,
        chain: getChainForAddress(challengeParams.address),
        options: {
          skipTimestampVerification: true,
          skipAssetVerification: true
        }
      }
    );

    if (!response.success) {
      throw "Signature was invalid: " + response.message;
    }

    await insertToDB(AUTH_CODES_DB, {
      _id: reqBody.signature,
      ...reqBody,
      cosmosAddress: convertToCosmosAddress(challengeParams.address),
      params: challengeParams,
    });

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error creating QR auth code. Please try again later."
    })
  }
}

export const getAuthCode = async (expressReq: Request, res: Response<GetBlockinAuthCodeRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetBlockinAuthCodeRouteRequestBody;

    const doc = await AUTH_CODES_DB.get(reqBody.signature).catch(catch404);
    if (!doc) {
      throw new Error("Auth code with provided signature not found.");
    }
    const params = doc.params;
    try {
      const verificationResponse = await genericBlockinVerify(
        {
          message: constructChallengeStringFromChallengeObject(params, getChainForAddress(params.address)),
          signature: reqBody.signature,
          chain: getChainForAddress(params.address),
          options: reqBody.options,
        }
      );

      return res.status(200).send({
        message: constructChallengeStringFromChallengeObject(params, getChainForAddress(params.address)),
        blockinSuccess: verificationResponse.success,
        blockinMessage: verificationResponse.message,
      });
    } catch (e) {
      return res.status(200).send({
        message: constructChallengeStringFromChallengeObject(params, getChainForAddress(params.address)),
        blockinSuccess: false,
        blockinMessage: e.message,
      });
    }



  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting auth QR code. Please try again later."
    })
  }
}

export const deleteAuthCode = async (expressReq: Request, res: Response<DeleteBlockinAuthCodeRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as DeleteBlockinAuthCodeRouteRequestBody;

    const doc = await AUTH_CODES_DB.get(reqBody.signature).catch(catch404);
    if (!doc) {
      throw new Error("Auth code with provided signature not found.");
    }

    await AUTH_CODES_DB.destroy(doc._id, doc._rev);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error deleting QR auth code. Please try again later."
    })
  }
}