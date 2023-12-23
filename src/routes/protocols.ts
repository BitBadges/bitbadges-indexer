
import { NumberType } from "bitbadgesjs-proto";
import { GetCollectionForProtocolRouteRequestBody, GetCollectionForProtocolRouteResponse, GetProtocolsRouteRequestBody, GetProtocolsRouteResponse, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { client } from "../indexer";
import { mustGetManyFromDB, ProtocolModel } from "../db/db";

export const getProtocols = async (expressReq: Request, res: Response<GetProtocolsRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetProtocolsRouteRequestBody;

    const names = reqBody.names;

    if (names.length > 100) {
      throw 'Cannot fetch more than 100 at a time.'
    }

    const protocols = await mustGetManyFromDB(ProtocolModel, names);

    return res.status(200).send({
      protocols: protocols
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting follow details"
    });
  }
}


export const getCollectionForProtocol = async (expressReq: Request, res: Response<GetCollectionForProtocolRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetCollectionForProtocolRouteRequestBody;

    const name = reqBody.name;
    const address = reqBody.address;
    const cosmosAddress = convertToCosmosAddress(address);

    const collectionId = await client.badgesQueryClient?.protocols.getCollectionIdForProtocol(name, cosmosAddress);
    if (!collectionId) {
      throw new Error('Collection not found');
    }


    return res.status(200).send({
      collectionId: collectionId
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting follow details"
    });
  }


}


