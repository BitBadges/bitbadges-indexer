import { BalanceInfoWithDetails, GetBadgeBalanceByAddressRouteRequestBody, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, convertBalanceDoc, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { BALANCES_DB, COLLECTIONS_DB } from "../db/db";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers, getAddressMappingsFromDB } from "./utils";

export const getBadgeBalanceByAddress = async (req: Request, res: Response<GetBadgeBalanceByAddressRouteResponse<NumberType>>) => {
  //TODO: Support inherited balances
  try {

    const reqBody = req.body as GetBadgeBalanceByAddressRouteRequestBody;

    const cosmosAddress = `${req.params.cosmosAddress.toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    const response = await BALANCES_DB.get(docId).catch(catch404);

    let addressMappingIdsToFetch = [];
    for (const incoming of collection.defaultUserApprovedIncomingTransfers) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of collection.defaultUserApprovedOutgoingTransfers) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);

    }

    for (const incoming of response?.approvedIncomingTransfers ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of response?.approvedOutgoingTransfers ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch.map(id => {
      return {
        mappingId: id,
        collectionId: req.params.collectionId
      }
    }), false);

    const balanceToReturn = response ? removeCouchDBDetails(convertBalanceDoc(response, Stringify)) :
      {
        collectionId: req.params.collectionId,
        cosmosAddress: req.params.cosmosAddress,
        balances: [],
        approvedIncomingTransfers: collection.defaultUserApprovedIncomingTransfers,
        approvedOutgoingTransfers: collection.defaultUserApprovedOutgoingTransfers,
        userPermissions: collection.defaultUserPermissions,
        onChain: collection.balancesType === "Standard",
        updateHistory: [],
        _id: req.params.collectionId + ':' + cosmosAddress
      }



    const balanceToReturnConverted: BalanceInfoWithDetails<string> = {
      ...balanceToReturn,
      approvedIncomingTransfers: [],
      approvedOutgoingTransfers: [],
    }

    balanceToReturnConverted.approvedIncomingTransfers = appendDefaultForIncomingUserApprovedTransfers(balanceToReturn.approvedIncomingTransfers, addressMappings, req.params.cosmosAddress, reqBody.doNotHandleAllAndAppendDefaults);
    balanceToReturnConverted.approvedOutgoingTransfers = appendDefaultForOutgoingUserApprovedTransfers(balanceToReturn.approvedOutgoingTransfers, addressMappings, req.params.cosmosAddress, reqBody.doNotHandleAllAndAppendDefaults);

    return res.status(200).send({
      balance: balanceToReturnConverted,
    });


  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting badge balances"
    });
  }
}