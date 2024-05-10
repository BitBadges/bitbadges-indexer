import {
  ApprovalTrackerDoc,
  convertToCosmosAddress,
  type ErrorResponse,
  type NumberType,
  type iAmountTrackerIdDetails,
  type iChallengeTrackerIdDetails,
  type iGetBadgeActivityRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { getFromDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ApprovalTrackerModel, BalanceModel, MerkleChallengeModel, ReviewModel, TransferActivityModel } from '../db/schemas';
import { getQueryParamsFromBookmark, pageSize, getPaginationInfoToReturn, findWithPagination } from '../db/utils';

export async function executeBadgeActivityQuery(
  collectionId: string,
  badgeId: string,
  bookmark?: string,
  specificAddress?: string
): Promise<iGetBadgeActivityRouteSuccessResponse<NumberType> | ErrorResponse> {
  const totalSupplys = await mustGetFromDB(BalanceModel, `${collectionId}:Total`);

  let maxBadgeId = 1n;
  for (const balance of totalSupplys.balances) {
    for (const badgeId of balance.badgeIds) {
      if (BigInt(badgeId.end) > maxBadgeId) {
        maxBadgeId = BigInt(badgeId.end);
      }
    }
  }

  if (BigInt(maxBadgeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
  }

  let addrQuery = {};
  if (specificAddress) {
    if (specificAddress !== 'Mint') {
      specificAddress = convertToCosmosAddress(specificAddress);
    }

    addrQuery = {
      $or: [{ from: specificAddress }, { to: { $elemMatch: { $eq: specificAddress } } }, { initiatedBy: specificAddress }]
    };
  }

  const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, bookmark, false, 'timestamp', '_id');
  const query = {
    collectionId: Number(collectionId),
    balances: {
      $elemMatch: {
        badgeIds: {
          $elemMatch: {
            $and: [{ start: { $lte: Number(badgeId), $type: 'number' } }, { end: { $gte: Number(badgeId), $type: 'number' } }]
          }
        }
      }
    },
    $and: addrQuery ? [{ ...addrQuery }, { ...paginationParams }] : [{ ...paginationParams }]
  };

  const docs = await findInDB(TransferActivityModel, {
    query,
    sort: { timestamp: -1, _id: -1 },
    limit: pageSize
  });

  return {
    activity: docs,
    pagination: getPaginationInfoToReturn(docs)
  };
}

export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean, specificAddress?: string) {
  const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, bookmark, oldestFirst, 'timestamp', '_id');
  let addrQuery = {};
  if (specificAddress) {
    if (specificAddress !== 'Mint') {
      specificAddress = convertToCosmosAddress(specificAddress);
    }

    addrQuery = {
      $or: [{ from: specificAddress }, { to: { $elemMatch: { $eq: specificAddress } } }, { initiatedBy: specificAddress }]
    };
  }

  return await findWithPagination(TransferActivityModel, {
    query: { collectionId: Number(collectionId), $and: addrQuery ? [{ ...addrQuery }, { ...paginationParams }] : [{ ...paginationParams }] },
    sort: { timestamp: -1, _id: -1 },
    limit: pageSize
  });
}

export async function executeCollectionReviewsQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(ReviewModel, bookmark, oldestFirst, 'timestamp', '_id');
  return await findWithPagination(ReviewModel, {
    query: { collectionId: Number(collectionId), ...paginationParams },
    sort: { timestamp: -1, _id: -1 },
    limit: pageSize
  });
}

export async function fetchTotalAndUnmintedBalancesQuery(collectionId: string) {
  const totalPromise = mustGetFromDB(BalanceModel, `${collectionId}:Total`);
  const mintPromise = mustGetFromDB(BalanceModel, `${collectionId}:Mint`);

  const [totalDoc, mintDoc] = await Promise.all([totalPromise, mintPromise]);

  return {
    docs: [totalDoc, mintDoc],
    pagination: {
      bookmark: '1',
      hasMore: false
    }
  };
}

export async function executeCollectionBalancesQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(BalanceModel, bookmark, oldestFirst, '_id');
  return await findWithPagination(BalanceModel, {
    query: { collectionId: Number(collectionId), ...paginationParams },
    sort: { _id: -1 },
    limit: pageSize
  });
}

export async function executeCollectionMerkleChallengesQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(MerkleChallengeModel, bookmark, oldestFirst, '_id');
  return await findWithPagination(MerkleChallengeModel, {
    query: { collectionId: Number(collectionId), ...paginationParams },
    sort: { _id: -1 },
    limit: pageSize
  });
}

export async function executeMerkleChallengeByIdsQuery(
  collectionId: string,
  challengeTrackerIdsToFetch: Array<iChallengeTrackerIdDetails<NumberType>>
) {
  if (challengeTrackerIdsToFetch.length > 100) {
    throw new Error('You can only fetch up to 100 merkle challenges at a time.');
  }

  const docs = await Promise.all(
    challengeTrackerIdsToFetch.map(async (idObj) => {
      const docId = `${collectionId}:${idObj.approvalLevel}-${idObj.approverAddress}-${idObj.approvalId}-${idObj.challengeTrackerId}`;
      const res = await getFromDB(MerkleChallengeModel, docId);

      return (
        res ?? {
          _docId: docId,
          collectionId: Number(collectionId),
          approvalId: idObj.approvalId,
          challengeTrackerId: idObj.challengeTrackerId,
          approvalLevel: idObj.approvalLevel,
          approverAddress: idObj.approverAddress,
          usedLeafIndices: []
        }
      );
    })
  );

  return docs;
}

export async function executeApprovalTrackersByIdsQuery(collectionId: string, idsToFetch: Array<iAmountTrackerIdDetails<NumberType>>) {
  if (idsToFetch.length > 100) {
    throw new Error('You can only fetch up to 100 approval trackers at a time.');
  }

  const docs = await Promise.all(
    idsToFetch.map(async (idObj) => {
      const docId = `${collectionId}:${idObj.approvalLevel}-${idObj.approverAddress}-${idObj.approvalId}-${idObj.amountTrackerId}-${idObj.trackerType}-${idObj.approvedAddress}`;
      const res = await getFromDB(ApprovalTrackerModel, docId);

      return (
        res ??
        new ApprovalTrackerDoc<bigint>({
          _docId: docId,
          collectionId: BigInt(collectionId),
          approvalId: idObj.approvalId,
          approvalLevel: idObj.approvalLevel,
          approverAddress: idObj.approverAddress,
          amountTrackerId: idObj.amountTrackerId,
          trackerType: idObj.trackerType,
          approvedAddress: idObj.approvedAddress,
          numTransfers: 0n,
          amounts: []
        })
      );
    })
  );

  return docs;
}

export async function executeCollectionApprovalTrackersQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(ApprovalTrackerModel, bookmark, oldestFirst, '_id');
  return await findWithPagination(ApprovalTrackerModel, {
    query: { collectionId: Number(collectionId), ...paginationParams },
    sort: { _id: -1 },
    limit: pageSize
  });
}
