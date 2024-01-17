import { AddressList, Balance, BigIntify, JSPrimitiveNumberType, UserPermissions, convertBalance, convertOffChainBalancesMetadataTimeline } from "bitbadgesjs-proto";
import { BalanceDocWithDetails, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, UserPermissionsWithDetails, convertBalanceDoc, convertCollectionDoc, convertToCosmosAddress, convertUserPermissionsWithDetails, getCurrentValueForTimeline } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { fetchUriFromSource } from "../queue";
import { cleanBalanceArray } from "../utils/dataCleaners";
import { BalanceModel, CollectionModel, getFromDB, mustGetFromDB } from "../db/db";
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from "./utils";
import { getBalancesForEthFirstTx } from "./ethFirstTx";

//Precondition: we assume all address lists are present
export const applyAddressListsToUserPermissions = (userPermissions: UserPermissions<JSPrimitiveNumberType>, addressLists: AddressList[]): UserPermissionsWithDetails<JSPrimitiveNumberType> => {
  return {
    ...userPermissions,
    canUpdateIncomingApprovals: userPermissions.canUpdateIncomingApprovals.map((x) => {
      return {
        ...x,
        fromList: addressLists.find((y) => y.listId === x.fromListId) as AddressList,
        initiatedByList: addressLists.find((y) => y.listId === x.initiatedByListId) as AddressList,
      }
    }),
    canUpdateOutgoingApprovals: userPermissions.canUpdateOutgoingApprovals.map((x) => {
      return {
        ...x,
        toList: addressLists.find((y) => y.listId === x.toListId) as AddressList,
        initiatedByList: addressLists.find((y) => y.listId === x.initiatedByListId) as AddressList,
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
          _docId: req.params.collectionId + ':' + cosmosAddress,
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

      let addressListIdsToFetch = [];
      for (const incoming of collection.defaultBalances.incomingApprovals) {
        addressListIdsToFetch.push(incoming.fromListId, incoming.initiatedByListId);
      }

      for (const outgoing of collection.defaultBalances.outgoingApprovals) {
        addressListIdsToFetch.push(outgoing.toListId, outgoing.initiatedByListId);
      }

      for (const incoming of response?.incomingApprovals ?? []) {
        addressListIdsToFetch.push(incoming.fromListId, incoming.initiatedByListId);
      }

      for (const outgoing of response?.outgoingApprovals ?? []) {
        addressListIdsToFetch.push(outgoing.toListId, outgoing.initiatedByListId);
      }

      for (const incoming of response?.userPermissions.canUpdateIncomingApprovals ?? []) {
        addressListIdsToFetch.push(incoming.fromListId, incoming.initiatedByListId);
      }

      for (const outgoing of response?.userPermissions.canUpdateOutgoingApprovals ?? []) {
        addressListIdsToFetch.push(outgoing.toListId, outgoing.initiatedByListId);
      }

      for (const incoming of collection?.defaultBalances.userPermissions?.canUpdateIncomingApprovals ?? []) {
        addressListIdsToFetch.push(incoming.fromListId, incoming.initiatedByListId);
      }

      for (const outgoing of collection?.defaultBalances.userPermissions?.canUpdateOutgoingApprovals ?? []) {
        addressListIdsToFetch.push(outgoing.toListId, outgoing.initiatedByListId);
      }

      const addressLists = await getAddressListsFromDB(addressListIdsToFetch.map(id => {
        return {
          listId: id,
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
          _docId: req.params.collectionId + ':' + cosmosAddress
        }



      const balanceToReturnConverted: BalanceDocWithDetails<string> = {
        ...balanceToReturn,
        incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balanceToReturn, addressLists, req.params.cosmosAddress),
        outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balanceToReturn, addressLists, req.params.cosmosAddress),
        userPermissions: convertUserPermissionsWithDetails(applyAddressListsToUserPermissions(balanceToReturn.userPermissions, addressLists), Stringify),
      }


      return res.status(200).send({
        balance: balanceToReturnConverted,
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error getting badge balances"
    });
  }
}