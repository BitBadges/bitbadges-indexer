import {
  type ErrorResponse,
  convertToCosmosAddress,
  type iGetCollectionForProtocolRouteSuccessResponse,
  type iGetProtocolsRouteSuccessResponse,
  type GetCollectionForProtocolRouteRequestBody,
  type GetProtocolsRouteRequestBody,
  type NumberType
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { mustGetManyFromDB } from '../db/db';
import { ProtocolModel } from '../db/schemas';
import { client } from '../indexer';
import { connectToRpc } from '../poll';

export const getProtocols = async (req: Request, res: Response<iGetProtocolsRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetProtocolsRouteRequestBody;

    const names = reqBody.names;

    if (names.length > 100) {
      throw new Error('Cannot fetch more than 100 protocols at a time.');
    }

    const protocols = await mustGetManyFromDB(ProtocolModel, names);

    return res.status(200).send({
      protocols
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting protocols'
    });
  }
};

export const getCollectionForProtocol = async (
  req: Request,
  res: Response<iGetCollectionForProtocolRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqBody = req.body as GetCollectionForProtocolRouteRequestBody;

    const name = reqBody.name;
    const address = reqBody.address;
    const cosmosAddress = convertToCosmosAddress(address);

    if (!client) {
      await connectToRpc();
    }

    const collectionId = await client.badgesQueryClient?.protocols.getCollectionIdForProtocol(name, cosmosAddress);

    return res.status(200).send({
      collectionId: collectionId ?? 0n
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting follow details'
    });
  }
};
