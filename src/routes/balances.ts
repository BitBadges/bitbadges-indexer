import { BalanceInfoWithDetails, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, convertBalanceDoc, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { BALANCES_DB, COLLECTIONS_DB } from "../db/db";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers, getAddressMappingsFromDB } from "./utils";

export const getBadgeBalanceByAddress = async (req: Request, res: Response<GetBadgeBalanceByAddressRouteResponse<NumberType>>) => {
  //TODO: Support inherited balances
  try {

    const cosmosAddress = `${req.params.cosmosAddress.toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    const response = await BALANCES_DB.get(docId).catch(catch404);

    let addressMappingIdsToFetch = [];
    for (const incomingTimeline of collection.defaultUserApprovedIncomingTransfersTimeline) {
      for (const incoming of incomingTimeline.approvedIncomingTransfers) {
        addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
      }
    }

    for (const outgoingTimeline of collection.defaultUserApprovedOutgoingTransfersTimeline) {
      for (const outgoing of outgoingTimeline.approvedOutgoingTransfers) {
        addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
      }
    }

    const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch.map(id => {
      return {
        mappingId: id,
        collectionId: req.params.collectionId
      }
    }));

    const balanceToReturn = response ? removeCouchDBDetails(convertBalanceDoc(response, Stringify)) :
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

    const balanceToReturnConverted: BalanceInfoWithDetails<string> = {
      ...balanceToReturn,
      approvedIncomingTransfersTimeline: [],
      approvedOutgoingTransfersTimeline: [],
    }

    balanceToReturnConverted.approvedIncomingTransfersTimeline = appendDefaultForIncomingUserApprovedTransfers(balanceToReturn.approvedIncomingTransfersTimeline, addressMappings, req.params.cosmosAddress);
    balanceToReturnConverted.approvedOutgoingTransfersTimeline = appendDefaultForOutgoingUserApprovedTransfers(balanceToReturn.approvedOutgoingTransfersTimeline, addressMappings, req.params.cosmosAddress);

    return res.status(200).send({
      balance: balanceToReturnConverted,
    });


  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting badge balances"
    });
  }
}