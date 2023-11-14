import { AddressMapping, JSPrimitiveNumberType, UserPermissions } from "bitbadgesjs-proto";
import { BalanceInfoWithDetails, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, UserPermissionsWithDetails, convertBalanceDoc, convertCollectionDoc, convertUserPermissionsWithDetails } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { BALANCES_DB, COLLECTIONS_DB } from "../db/db";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";

export const applyAddressMappingsToUserPermissions = (userPermissions: UserPermissions<JSPrimitiveNumberType>, addressMappings: AddressMapping[]): UserPermissionsWithDetails<JSPrimitiveNumberType> => {
  return {
    ...userPermissions,
    canUpdateIncomingApprovals: userPermissions.canUpdateIncomingApprovals.map((x) => {
      return {
        ...x,
        fromMapping: addressMappings.find((y) => y.mappingId === x.fromMappingId) as AddressMapping,
        initiatedByMapping: addressMappings.find((y) => y.mappingId === x.initiatedByMappingId) as AddressMapping,
      }
    }),
    canUpdateOutgoingApprovals: userPermissions.canUpdateOutgoingApprovals.map((x) => {
      return {
        ...x,
        toMapping: addressMappings.find((y) => y.mappingId === x.toMappingId) as AddressMapping,
        initiatedByMapping: addressMappings.find((y) => y.mappingId === x.initiatedByMappingId) as AddressMapping,
      }
    })
  }
}

export const getBadgeBalanceByAddress = async (req: Request, res: Response<GetBadgeBalanceByAddressRouteResponse<NumberType>>) => {
  //TODO: Support inherited balances
  try {

    const cosmosAddress = `${req.params.cosmosAddress.toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    const response = await BALANCES_DB.get(docId).catch(catch404);

    let addressMappingIdsToFetch = [];
    for (const incoming of collection.defaultUserIncomingApprovals) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of collection.defaultUserOutgoingApprovals) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of response?.incomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of response?.outgoingApprovals ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of response?.userPermissions.canUpdateIncomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of response?.userPermissions.canUpdateOutgoingApprovals ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of collection?.defaultUserPermissions?.canUpdateIncomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of collection?.defaultUserPermissions?.canUpdateOutgoingApprovals ?? []) {
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
        incomingApprovals: collection.defaultUserIncomingApprovals,
        outgoingApprovals: collection.defaultUserOutgoingApprovals,
        autoApproveSelfInitiatedOutgoingTransfers: collection.defaultAutoApproveSelfInitiatedOutgoingTransfers,
        autoApproveSelfInitiatedIncomingTransfers: collection.defaultAutoApproveSelfInitiatedIncomingTransfers,
        userPermissions: collection.defaultUserPermissions,
        onChain: collection.balancesType === "Standard",
        updateHistory: [],
        _id: req.params.collectionId + ':' + cosmosAddress
      }



    const balanceToReturnConverted: BalanceInfoWithDetails<string> = {
      ...balanceToReturn,
      incomingApprovals: appendDefaultForIncomingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
      outgoingApprovals: appendDefaultForOutgoingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
      userPermissions: convertUserPermissionsWithDetails(applyAddressMappingsToUserPermissions(balanceToReturn.userPermissions, addressMappings), Stringify),
    }


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