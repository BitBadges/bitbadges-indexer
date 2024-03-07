import {
  type ErrorResponse,
  UserPermissionsWithDetails,
  convertToCosmosAddress,
  type iAddressList,
  type iGetBadgeBalanceByAddressRouteSuccessResponse,
  type iUserPermissions,
  type NumberType
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { fetchUriFromSource } from '../queue';
import { cleanBalanceArray } from '../utils/dataCleaners';
import { getBalancesForEthFirstTx } from './ethFirstTx';
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from './utils';
import { BalanceModel, CollectionModel } from '../db/schemas';
import { mustGetFromDB, getFromDB } from '../db/db';

export function mustFind<T>(arr: T[], callbackFunc: (x: T) => boolean) {
  const found = arr.find(callbackFunc);
  if (!found) {
    throw new Error('Not found in mustFind');
  }
  return found;
}

export function mustFindAddressList(addressLists: iAddressList[], id: string) {
  return mustFind(addressLists, (x) => x.listId === id);
}

// Precondition: we assume all address lists are present
export const applyAddressListsToUserPermissions = <T extends NumberType>(
  userPermissions: iUserPermissions<T>,
  addressLists: iAddressList[]
): UserPermissionsWithDetails<T> => {
  return new UserPermissionsWithDetails<T>({
    ...userPermissions,
    canUpdateIncomingApprovals: userPermissions.canUpdateIncomingApprovals.map((x) => {
      return {
        ...x,
        fromList: mustFindAddressList(addressLists, x.fromListId),
        initiatedByList: mustFindAddressList(addressLists, x.initiatedByListId)
      };
    }),
    canUpdateOutgoingApprovals: userPermissions.canUpdateOutgoingApprovals.map((x) => {
      return {
        ...x,
        toList: mustFindAddressList(addressLists, x.toListId),
        initiatedByList: mustFindAddressList(addressLists, x.initiatedByListId)
      };
    })
  });
};

export const getBadgeBalanceByAddress = async (
  req: Request,
  res: Response<iGetBadgeBalanceByAddressRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const cosmosAddress = `${convertToCosmosAddress(req.params.cosmosAddress).toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`;
    const collection = await mustGetFromDB(CollectionModel, req.params.collectionId);

    if (collection.balancesType === 'Off-Chain - Non-Indexed') {
      // we need to fetch from source directly
      const uri = collection.getOffChainBalancesMetadata()?.uri;
      const uriToFetch = uri?.replace('{address}', convertToCosmosAddress(cosmosAddress));
      if (!uriToFetch) {
        throw new Error('No URI to fetch found. URI must be present for non-indexed off-chain balances.');
      }

      let balancesRes;
      if (uriToFetch === 'https://api.bitbadges.io/api/v0/ethFirstTx/' + cosmosAddress) {
        // Hardcoded to fetch locally instead of from source GET
        balancesRes = await getBalancesForEthFirstTx(cosmosAddress);
      } else {
        const res = await fetchUriFromSource(uriToFetch);
        balancesRes = res?.balances;
      }

      // Check if valid array
      const balances = cleanBalanceArray(balancesRes);
      return res.status(200).send({
        _docId: req.params.collectionId + ':' + cosmosAddress,
        collectionId: req.params.collectionId,
        cosmosAddress: req.params.cosmosAddress,
        balances,
        incomingApprovals: [],
        outgoingApprovals: [],
        autoApproveSelfInitiatedOutgoingTransfers: false,
        autoApproveSelfInitiatedIncomingTransfers: false,
        userPermissions: {
          canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
          canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
          canUpdateIncomingApprovals: [],
          canUpdateOutgoingApprovals: []
        },
        onChain: false,
        updateHistory: []
      });
    } else {
      const response = await getFromDB(BalanceModel, docId);

      const addressListIdsToFetch = [];
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

      const addressLists = await getAddressListsFromDB(
        addressListIdsToFetch.map((id) => {
          return {
            listId: id,
            collectionId: req.params.collectionId
          };
        }),
        false
      );

      const balanceToReturn = response ?? {
        collectionId: req.params.collectionId,
        cosmosAddress: req.params.cosmosAddress,
        balances: collection.defaultBalances.balances,
        incomingApprovals: collection.defaultBalances.incomingApprovals,
        outgoingApprovals: collection.defaultBalances.outgoingApprovals,
        autoApproveSelfInitiatedOutgoingTransfers: collection.defaultBalances.autoApproveSelfInitiatedOutgoingTransfers,
        autoApproveSelfInitiatedIncomingTransfers: collection.defaultBalances.autoApproveSelfInitiatedIncomingTransfers,
        userPermissions: collection.defaultBalances.userPermissions,
        onChain: collection.balancesType === 'Standard',
        updateHistory: [],
        _docId: req.params.collectionId + ':' + cosmosAddress
      };

      const balanceToReturnConverted = {
        ...balanceToReturn,
        incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balanceToReturn, addressLists, req.params.cosmosAddress),
        outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balanceToReturn, addressLists, req.params.cosmosAddress),
        userPermissions: applyAddressListsToUserPermissions(balanceToReturn.userPermissions, addressLists)
      };

      return res.status(200).send(balanceToReturnConverted);
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting badge balances'
    });
  }
};
