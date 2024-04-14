import {
  ApprovalTrackerDoc,
  type JSPrimitiveNumberType,
  type ErrorResponse,
  type NumberType,
  type iAmountTrackerIdDetails,
  type iChallengeTrackerIdDetails,
  type iGetBadgeActivityRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import type mongoose from 'mongoose';
import { getFromDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import {
  ApprovalTrackerModel,
  BalanceModel,
  type BitBadgesDoc,
  MerkleChallengeModel,
  ReviewModel,
  TransferActivityModel,
  type TypedDocFromModel
} from '../db/schemas';
const pageSize = 25;

export async function findWithPagination<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  options: {
    query: mongoose.FilterQuery<T>;
    session?: mongoose.mongo.ClientSession;
    limit?: number;
    skip?: number;
    sort?: any;
  }
): Promise<{ docs: S[]; pagination: { bookmark: string; hasMore: boolean } }> {
  const docs = await findInDB<T, S>(model, options);
  return {
    docs,
    pagination: getPaginationInfoToReturn(docs)
  };
}

export async function executeBadgeActivityQuery(
  collectionId: string,
  badgeId: string,
  bookmark?: string
): Promise<iGetBadgeActivityRouteSuccessResponse<NumberType> | ErrorResponse> {
  // Check if badgeId > Number.MAX_SAFE_INTEGER
  // If so, we need to do a string query because it is saved in DB as a string
  // Otherwise, we can do a number query

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
    // TODO: Support string-number queries
    throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
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
    ...paginationParams
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

export const getPaginationInfoToReturn = (docs: any[]) => {
  const newBookmark = docs.length > 0 ? docs[docs.length - 1]._id.toString() : undefined;
  return {
    bookmark: newBookmark ?? '',
    hasMore: docs.length === pageSize
  };
};

// A little naive bc we always assume descending (-1) sort order
// But basically what this does is ensures the query starts at the last fetched doc + 1
// If we have duplicate primary sort fields, we need to handle based on the secondary sort field
export const getQueryParamsFromBookmark = async (
  model: mongoose.Model<any>,
  bookmark: string | undefined,
  oldestFirst: boolean | undefined,
  primarySort: string,
  secondarySort?: string
) => {
  let lastFetchedDoc: any = null;
  if (bookmark) {
    lastFetchedDoc = await model.findOne({ _id: bookmark }).lean().exec();
  }

  const operator = oldestFirst ? '$gt' : '$lt';

  if (secondarySort) {
    return {
      $or: lastFetchedDoc
        ? [
            {
              [primarySort]: { $eq: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] },
              [secondarySort]: {
                [`${operator}`]: lastFetchedDoc[secondarySort as keyof typeof lastFetchedDoc]
              }
            },
            {
              [primarySort]: {
                [`${operator}`]: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc]
              }
            }
          ]
        : [
            {
              [primarySort]: { $exists: true }
            }
          ]
    };
  } else {
    return {
      [primarySort]: lastFetchedDoc ? { [`${operator}`]: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] } : { $exists: true }
    };
  }
};

export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, bookmark, oldestFirst, 'timestamp', '_id');
  return await findWithPagination(TransferActivityModel, {
    query: { collectionId: Number(collectionId), ...paginationParams },
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
      const docId = `${collectionId}:${idObj.challengeLevel}-${idObj.approverAddress}-${idObj.approvalId}-${idObj.challengeTrackerId}`;
      const res = await getFromDB(MerkleChallengeModel, docId);

      return (
        res ?? {
          _docId: docId,
          collectionId: Number(collectionId),
          approvalId: idObj.approvalId,
          challengeTrackerId: idObj.challengeTrackerId,
          challengeLevel: idObj.challengeLevel,
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
