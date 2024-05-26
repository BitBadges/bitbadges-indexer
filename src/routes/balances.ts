import {
  BalanceDocWithDetails,
  BigIntify,
  ClaimDetails,
  GetBadgeBalanceByAddressPayload,
  Stringify,
  UintRangeArray,
  UserPermissionsWithDetails,
  convertToCosmosAddress,
  iApprovalInfoDetails,
  iBalanceDocWithDetails,
  iChallengeDetails,
  type ErrorResponse,
  type NumberType,
  type iAddressList,
  type iGetBadgeBalanceByAddressSuccessResponse,
  type iUserPermissions
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { MaybeAuthenticatedRequest } from 'src/blockin/blockin_handlers';
import { getFromDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { BalanceModel, ClaimBuilderModel, CollectionModel } from '../db/schemas';
import { getPlugin } from '../integrations/types';
import { fetchUriFromSource, fetchUrisFromDbAndAddToQueueIfEmpty } from '../queue';
import { cleanBalanceArray } from '../utils/dataCleaners';
import { addChallengeDetailsToCriteria } from './badges';
import { getClaimDetailsForFrontend } from './collections';
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

export const getBalanceForAddress = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  collectionId: number,
  _cosmosAddress: string,
  options?: GetBadgeBalanceByAddressPayload | undefined
) => {
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
    const originalUri = uri;
    const uriToFetch = uri?.replace('{address}', convertToCosmosAddress(cosmosAddress));
    if (!uriToFetch) {
      throw new Error('No URI to fetch found. URI must be present for non-indexed off-chain balances.');
    }

    if (uriToFetch === 'https://api.bitbadges.io/api/v0/ethFirstTx/' + cosmosAddress) {
      // Hardcoded to fetch locally instead of from source GET
      const fetchedBalances = await getBalancesForEthFirstTx(cosmosAddress);
      balancesRes = {
        ...BlankUserBalance,
        _docId: collectionId + ':' + cosmosAddress,
        collectionId,
        cosmosAddress: _cosmosAddress,
        balances: fetchedBalances
      };
    } else if (originalUri === 'https://api.bitbadges.io/placeholder/{address}') {
      const claimDocs = await findInDB(ClaimBuilderModel, {
        query: {
          collectionId: Number(collectionId),
          deletedAt: {
            $exists: false
          }
        },
        limit: 1
      });
      if (claimDocs.length === 0) {
        throw new Error('No claim found');
      }

      const claim = claimDocs[0];
      let success = true;
      for (const plugin of claimDocs[0].plugins) {
        const pluginObj = await getPlugin(plugin.type);
        const res = await pluginObj.validateFunction(
          {
            cosmosAddress,
            claimId: claim._docId,
            pluginId: plugin.id,
            pluginType: plugin.type,
            _isSimulation: false,
            lastUpdated: Number(claim.lastUpdated),
            createdAt: Number(claim.createdAt)
          },
          plugin.publicParams,
          plugin.privateParams
          // Everything else is N/A to non-indexed
        );

        if (!res.success) {
          success = false;
          break;
        }
      }

      const allBadges = await mustGetFromDB(BalanceModel, `${collectionId}:Total`);
      const allBadgesBalances = allBadges.balances.getAllBadgeIds();

      balancesRes = {
        ...BlankUserBalance,
        _docId: collectionId + ':' + cosmosAddress,
        collectionId,
        cosmosAddress: _cosmosAddress,
        balances: [
          {
            amount: success ? 1 : 0,
            badgeIds: allBadgesBalances,
            ownershipTimes: UintRangeArray.FullRanges()
          }
        ]
      };
    } else {
      const res = await fetchUriFromSource(uriToFetch);
      balancesRes = res?.balances;
    }
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
          collectionId
        };
      }),
      false
    );

    const urisToFetch = [
      ...[response]?.flatMap((x) => x?.incomingApprovals.map((y) => y.uri)),
      ...[response]?.flatMap((x) => x?.outgoingApprovals.map((y) => y.uri)),
      ...[response]?.flatMap((x) => x?.incomingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri))),
      ...[response]?.flatMap((x) => x?.outgoingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri)))
    ]
      .filter((x) => x)
      .filter((x, i, arr) => arr.indexOf(x) === i) as string[];

    const claimIds = [
      ...[response].flatMap((x) => x?.incomingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.flatMap((z) => z.challengeTrackerId))),
      ...[response].flatMap((x) => x?.outgoingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.flatMap((z) => z.challengeTrackerId)))
    ]
      .filter((x) => x)
      .filter((x, i, arr) => arr.indexOf(x) === i) as string[];

    const docs = await findInDB(ClaimBuilderModel, {
      query: {
        collectionId: Number(collectionId),
        docClaimed: true,
        cid: {
          $in: claimIds
        },
        deletedAt: { $exists: false }
      }
    });

    const claimDetails: Array<ClaimDetails<bigint>> = [];
    if (docs.length > 0) {
      for (const doc of docs) {
        const newClaimDetails = await getClaimDetailsForFrontend(req, [doc], options?.fetchPrivateParams, doc.trackerDetails);
        claimDetails.push(...newClaimDetails);
      }
    }

    const results = await fetchUrisFromDbAndAddToQueueIfEmpty(urisToFetch, collectionId.toString());

    const balanceToReturn = response ?? {
      collectionId,
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

    const balanceToReturnConverted: iBalanceDocWithDetails<NumberType> = {
      ...balanceToReturn,
      incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balanceToReturn, addressLists, _cosmosAddress).map((x) => {
        return {
          ...x,
          details: results.find((y) => y.uri === x.uri)?.content as iApprovalInfoDetails | undefined,
          approvalCriteria: addChallengeDetailsToCriteria(
            x.approvalCriteria,
            results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[],
            claimDetails
          )
        };
      }),
      outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balanceToReturn, addressLists, _cosmosAddress).map((x) => {
        return {
          ...x,
          details: results.find((y) => y.uri === x.uri)?.content as iApprovalInfoDetails | undefined,
          approvalCriteria: addChallengeDetailsToCriteria(
            x.approvalCriteria,
            results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[],
            claimDetails
          )
        };
      }),
      userPermissions: applyAddressListsToUserPermissions(balanceToReturn.userPermissions, addressLists)
    };

    balancesRes = balanceToReturnConverted;
  }

  // Check if valid array
  const balances = cleanBalanceArray(balancesRes.balances);
  return new BalanceDocWithDetails<NumberType>({
    ...balancesRes,
    _docId: collectionId + ':' + cosmosAddress,
    collectionId,
    cosmosAddress: _cosmosAddress,
    balances
  }).convert(BigIntify);
};

export const getBadgeBalanceByAddress = async (req: Request, res: Response<iGetBadgeBalanceByAddressSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const balanceToReturnConverted = await getBalanceForAddress(
      req,
      Number(req.params.collectionId),
      req.params.cosmosAddress,
      req.body as unknown as GetBadgeBalanceByAddressPayload
    );
    return res.status(200).send(balanceToReturnConverted.convert(Stringify));
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting badge balances'
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
