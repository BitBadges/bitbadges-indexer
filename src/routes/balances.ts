import { Request, Response } from "express";
import { BALANCES_DB, COLLECTIONS_DB } from "../db/db";
import { serializeError } from "serialize-error";
import { GetBadgeBalanceByAddressRouteResponse, Stringify, convertBalanceDoc, NumberType, convertCollectionDoc } from "bitbadgesjs-utils";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";

export const getBadgeBalanceByAddress = async (req: Request, res: Response<GetBadgeBalanceByAddressRouteResponse<NumberType>>) => {
  //TODO: Support inherited balances
  try {
    const cosmosAddress = `${req.params.cosmosAddress.toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    const response = await BALANCES_DB.get(docId).catch(catch404);

    return res.status(200).send({
      balance: response ? removeCouchDBDetails(convertBalanceDoc(response, Stringify)) :
        {
          collectionId: req.params.collectionId,
          cosmosAddress: req.params.cosmosAddress,
          balances: [],
          approvedIncomingTransfersTimeline: collection.defaultUserApprovedIncomingTransfersTimeline,
          approvedOutgoingTransfersTimeline: collection.defaultUserApprovedOutgoingTransfersTimeline,
          userPermissions: collection.defaultUserPermissions,
          onChain: collection.balancesType === "Standard",
          _id: req.params.collectionId + ':' + cosmosAddress
        }
    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting badge balances"
    });
  }
}