import { AddressMapping, Balance, BigIntify, JSPrimitiveNumberType, UserPermissions, convertBalance, convertOffChainBalancesMetadataTimeline } from "bitbadgesjs-proto";
import { BalanceDocWithDetails, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, UserPermissionsWithDetails, convertBalanceDoc, convertCollectionDoc, convertToCosmosAddress, convertUserPermissionsWithDetails, getCurrentValueForTimeline } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { fetchUriFromSource } from "../queue";
import { cleanBalanceArray } from "../utils/dataCleaners";
import { BalanceModel, CollectionModel, getFromDB, mustGetFromDB } from "../db/db";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";
import { getBalancesForEthFirstTx } from "./ethFirstTx";

//Precondition: we assume all address mappings are present
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
  try {

    const cosmosAddress = `${convertToCosmosAddress(req.params.cosmosAddress).toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await mustGetFromDB(CollectionModel, req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    if (collection.balancesType === "Off-Chain - Non-Indexed") {
      //we need to fetch from source directly
      const uri = getCurrentValueForTimeline(collection.offChainBalancesMetadataTimeline.map(x => convertOffChainBalancesMetadataTimeline(x, BigIntify)))?.offChainBalancesMetadata.uri
      const uriToFetch = uri?.replace("{address}", convertToCosmosAddress(cosmosAddress));
      if (!uriToFetch) {
        throw new Error("No URI to fetch found. URI must be present for non-indexed off-chain balances.");
      }

      let balancesRes = undefined;
      if (uriToFetch === "https://api.bitbadges.io/api/v0/ethFirstTx/" + cosmosAddress) {
        //Hardcoded to fetch locally instead of from source GET
        balancesRes = await getBalancesForEthFirstTx(cosmosAddress);
      } else {
        const res = await fetchUriFromSource(uriToFetch);
        balancesRes = res?.balances;
      }

      //Check if valid array
      const balances: Balance<NumberType>[] = cleanBalanceArray(balancesRes);

      return res.status(200).send({
        balance: {
          _legacyId: req.params.collectionId + ':' + cosmosAddress,
          collectionId: req.params.collectionId,
          cosmosAddress: req.params.cosmosAddress,
          balances: balances.map(x => convertBalance(x, BigIntify)),
          incomingApprovals: [],
          outgoingApprovals: [],
          autoApproveSelfInitiatedOutgoingTransfers: false,
          autoApproveSelfInitiatedIncomingTransfers: false,
          userPermissions: {
            canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
            canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
            canUpdateIncomingApprovals: [],
            canUpdateOutgoingApprovals: [],
          },
          onChain: false,
          updateHistory: [],

        }
      });
    } else {

      const response = await getFromDB(BalanceModel, docId);

      let addressMappingIdsToFetch = [];
      for (const incoming of collection.defaultBalances.incomingApprovals) {
        addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
      }

      for (const outgoing of collection.defaultBalances.outgoingApprovals) {
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

      for (const incoming of collection?.defaultBalances.userPermissions?.canUpdateIncomingApprovals ?? []) {
        addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
      }

      for (const outgoing of collection?.defaultBalances.userPermissions?.canUpdateOutgoingApprovals ?? []) {
        addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
      }

      const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch.map(id => {
        return {
          mappingId: id,
          collectionId: req.params.collectionId
        }
      }), false);

      const balanceToReturn = response ? convertBalanceDoc(response, Stringify) :
        {
          collectionId: req.params.collectionId,
          cosmosAddress: req.params.cosmosAddress,
          balances: collection.defaultBalances.balances,
          incomingApprovals: collection.defaultBalances.incomingApprovals,
          outgoingApprovals: collection.defaultBalances.outgoingApprovals,
          autoApproveSelfInitiatedOutgoingTransfers: collection.defaultBalances.autoApproveSelfInitiatedOutgoingTransfers,
          autoApproveSelfInitiatedIncomingTransfers: collection.defaultBalances.autoApproveSelfInitiatedIncomingTransfers,
          userPermissions: collection.defaultBalances.userPermissions,
          onChain: collection.balancesType === "Standard",
          updateHistory: [],
          _legacyId: req.params.collectionId + ':' + cosmosAddress
        }



      const balanceToReturnConverted: BalanceDocWithDetails<string> = {
        ...balanceToReturn,
        incomingApprovals: appendDefaultForIncomingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
        outgoingApprovals: appendDefaultForOutgoingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
        userPermissions: convertUserPermissionsWithDetails(applyAddressMappingsToUserPermissions(balanceToReturn.userPermissions, addressMappings), Stringify),
      }


      return res.status(200).send({
        balance: balanceToReturnConverted,
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting badge balances"
    });
  }
}