import {
  BalanceDocWithDetails,
  BigIntify,
  Stringify,
  UintRangeArray,
  UserPermissionsWithDetails,
  convertToCosmosAddress,
  type ErrorResponse,
  type NumberType,
  type iAddressList,
  type iGetBadgeBalanceByAddressRouteSuccessResponse,
  type iUserPermissions
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { getFromDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { BalanceModel, ClaimBuilderModel, CollectionModel } from '../db/schemas';
import { getPlugin, getPluginParamsAndState } from '../integrations/types';
import { fetchUriFromSource } from '../queue';
import { cleanBalanceArray } from '../utils/dataCleaners';
import { getBalancesForEthFirstTx } from './ethFirstTx';
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from './utils';

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

export const getBalanceForAddress = async (collectionId: number, _cosmosAddress: string) => {
  const cosmosAddress = `${convertToCosmosAddress(_cosmosAddress).toString()}`;
  const docId = `${collectionId}:${cosmosAddress}`;
  const collection = await mustGetFromDB(CollectionModel, collectionId.toString());
  let balancesRes;
  if (collection.balancesType === 'Non-Public') {
    throw new Error(
      'This collection has balances that are private or none at all. These are not accessible via the BitBadges API but rather through a self-implementation by the collection.'
    );
  } else if (collection.balancesType === 'Off-Chain - Non-Indexed') {
    // We need to fetch from source directly
    const uri = collection.getOffChainBalancesMetadata()?.uri;
    const uriToFetch = uri?.replace('{address}', convertToCosmosAddress(cosmosAddress));
    if (!uriToFetch) {
      throw new Error('No URI to fetch found. URI must be present for non-indexed off-chain balances.');
    }

    if (uriToFetch === 'https://api.bitbadges.io/api/v0/ethFirstTx/' + cosmosAddress) {
      // Hardcoded to fetch locally instead of from source GET
      balancesRes = await getBalancesForEthFirstTx(cosmosAddress);
    } else if (uriToFetch === 'https://api.bitbadges.io/placeholder/{address}') {
      const claimDocs = await findInDB(ClaimBuilderModel, { query: { collectionId: Number(collectionId) }, limit: 1 });
      if (claimDocs.length === 0) {
        throw new Error('No claim found');
      }

      const apiDetails = getPluginParamsAndState('api', claimDocs[0].plugins);
      if (!apiDetails) {
        throw new Error('No API details found');
      }

      const claim = claimDocs[0];
      const apiCalls = apiDetails.publicParams?.apiCalls;
      if (!apiCalls) {
        throw new Error('No API calls found');
      }

      const allBadges = await mustGetFromDB(BalanceModel, `${collectionId}:Total`);
      const allBadgesBalances = allBadges.balances.getAllBadgeIds();

      const apiRes = await getPlugin('api').validateFunction(
        {
          cosmosAddress: cosmosAddress,
          claimId: claim._docId
        },
        apiDetails.publicParams,
        apiDetails.privateParams
        //Everything else is N/A to non-indexed
      );

      balancesRes = {
        ...BlankUserBalance,
        _docId: collectionId + ':' + cosmosAddress,
        collectionId: collectionId,
        cosmosAddress: _cosmosAddress,
        balances: [
          {
            amount: apiRes.success ? 1 : 0,
            badgeIds: allBadgesBalances,
            ownershipTimes: UintRangeArray.FullRanges()
          }
        ]
      };
    } else {
      const res = await fetchUriFromSource(uriToFetch);
      balancesRes = res?.balances;
    }

    balancesRes = cleanBalanceArray(balancesRes);
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
          collectionId: collectionId
        };
      }),
      false
    );

    const balanceToReturn = response ?? {
      collectionId: collectionId,
      cosmosAddress: _cosmosAddress,
      balances: collection.defaultBalances.balances,
      incomingApprovals: collection.defaultBalances.incomingApprovals,
      outgoingApprovals: collection.defaultBalances.outgoingApprovals,
      autoApproveSelfInitiatedOutgoingTransfers: collection.defaultBalances.autoApproveSelfInitiatedOutgoingTransfers,
      autoApproveSelfInitiatedIncomingTransfers: collection.defaultBalances.autoApproveSelfInitiatedIncomingTransfers,
      userPermissions: collection.defaultBalances.userPermissions,
      onChain: collection.balancesType === 'Standard',
      updateHistory: [],
      _docId: collectionId + ':' + cosmosAddress
    };

    const balanceToReturnConverted = {
      ...balanceToReturn,
      incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balanceToReturn, addressLists, _cosmosAddress),
      outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balanceToReturn, addressLists, _cosmosAddress),
      userPermissions: applyAddressListsToUserPermissions(balanceToReturn.userPermissions, addressLists)
    };

    balancesRes = balanceToReturnConverted;
  }

  // Check if valid array
  const balances = cleanBalanceArray(balancesRes);
  return new BalanceDocWithDetails<NumberType>({
    ...BlankUserBalance,
    _docId: collectionId + ':' + cosmosAddress,
    collectionId: collectionId,
    cosmosAddress: _cosmosAddress,
    balances
  }).convert(BigIntify);
};

export const getBadgeBalanceByAddress = async (
  req: Request,
  res: Response<iGetBadgeBalanceByAddressRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const balanceToReturnConverted = await getBalanceForAddress(Number(req.params.collectionId), req.params.cosmosAddress);
    return res.status(200).send(balanceToReturnConverted.convert(Stringify));
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting badge balances'
    });
  }
};

const BlankUserBalance = {
  balances: [],
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
};
