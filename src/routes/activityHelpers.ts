import { AmountTrackerIdDetails } from "bitbadgesjs-proto";
import { ChallengeTrackerIdDetails, GetBadgeActivityRouteResponse, NumberType, Stringify, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { ApprovalsTrackerModel, BalanceModel, MerkleChallengeModel, ReviewModel, TransferActivityModel, getFromDB, mustGetFromDB } from "../db/db";


export async function executeBadgeActivityQuery(collectionId: string, badgeId: string, bookmark?: string): Promise<GetBadgeActivityRouteResponse<NumberType>> {
  //Check if badgeId > Number.MAX_SAFE_INTEGER
  //If so, we need to do a string query because it is saved in DB as a string
  //Otherwise, we can do a number query

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
    //TODO: Support string-number queries
    throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
  }

  const query = {
    'collectionId': Number(collectionId),
    'balances': {
      "$elemMatch": {
        "badgeIds": {
          "$elemMatch": {
            "$and": [
              { "start": { "$lte": Number(badgeId), "$type": "number" } },
              { "end": { "$gte": Number(badgeId), "$type": "number" } }
            ]
          }
        }
      }
    }
  };
  const pageSize = 25;
  let mongoQuery = TransferActivityModel.find(query).sort({ timestamp: -1 }).limit(pageSize).lean();
  if (bookmark) {
    mongoQuery = mongoQuery.skip(bookmark ? pageSize * Number(bookmark) : 0);
  }
  const docs = await mongoQuery.exec();

  const activity = docs.map(x => convertTransferActivityDoc(x, Stringify));

  const newBookmark = (bookmark ? Number(bookmark) + 1 : 1).toString();

  return {
    activity: activity,
    pagination: {
      bookmark: newBookmark.toString(),
      hasMore: docs.length === pageSize,
    }
  };

}

export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string) {
  const activityRes = await TransferActivityModel.find({
    collectionId: Number(collectionId),
  }).sort({ timestamp: -1 }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  return {
    docs: activityRes.map(x => convertTransferActivityDoc(x, Stringify)),
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: activityRes.length === 25,
    }
  }
}

export async function executeCollectionAnnouncementsQuery(collectionId: string, bookmark?: string) {
  return {
    docs: [],
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: false,
    }
  }
}

export async function executeCollectionReviewsQuery(collectionId: string, bookmark?: string) {
  const reviewsRes = await ReviewModel.find({
    collectionId: Number(collectionId),
  }).sort({ timestamp: -1 }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  return {
    docs: reviewsRes,
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: reviewsRes.length === 25,
    }
  }
}

export async function fetchTotalAndUnmintedBalancesQuery(collectionId: string) {
  const totalPromise = mustGetFromDB(BalanceModel, `${collectionId}:Total`);
  const mintPromise = mustGetFromDB(BalanceModel, `${collectionId}:Mint`);

  const [totalDoc, mintDoc] = await Promise.all([totalPromise, mintPromise]);

  return {
    docs: [totalDoc, mintDoc],
    pagination: {
      bookmark: "1",
      hasMore: false,
    }
  };
}

export async function executeCollectionBalancesQuery(collectionId: string, bookmark?: string) {
  const balancesRes = await BalanceModel.find({
    collectionId: Number(collectionId),
  }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  return {
    docs: balancesRes,
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: balancesRes.length === 25,
    }
  }
}

export async function executeCollectionMerkleChallengesQuery(collectionId: string, bookmark?: string) {
  const merkleChallengesRes = await MerkleChallengeModel.find({
    collectionId: Number(collectionId),
  }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  return {
    docs: merkleChallengesRes,
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: merkleChallengesRes.length === 25,
    }
  }
}

export async function executeMerkleChallengeByIdsQuery(collectionId: string, challengeIdsToFetch: ChallengeTrackerIdDetails<NumberType>[]) {
  if (challengeIdsToFetch.length > 100) {
    throw new Error("You can only fetch up to 100 merkle challenges at a time.");
  }

  const docs = await Promise.all(challengeIdsToFetch.map(async (idObj) => {
    const docId = `${collectionId}:${idObj.challengeLevel}-${idObj.approverAddress}-${idObj.challengeId}`;
    const res = await getFromDB(MerkleChallengeModel, docId);

    return res ?? {
      _legacyId: docId,
      collectionId: Number(collectionId),
      challengeId: idObj.challengeId,
      challengeLevel: idObj.challengeLevel,
      approverAddress: idObj.approverAddress,
      usedLeafIndices: [],
    };
  }));

  return docs;

}

export async function executeApprovalsTrackersByIdsQuery(collectionId: string, idsToFetch: AmountTrackerIdDetails<bigint>[]) {
  if (idsToFetch.length > 100) {
    throw new Error("You can only fetch up to 100 approval trackers at a time.");
  }


  const docs = await Promise.all(idsToFetch.map(async (idObj) => {
    const docId = `${collectionId}:${idObj.approvalLevel}-${idObj.approverAddress}-${idObj.amountTrackerId}-${idObj.trackerType}-${idObj.approvedAddress}`;
    const res = await getFromDB(ApprovalsTrackerModel, docId);

    return res ?? {
      _legacyId: docId,
      collectionId: Number(collectionId),
      approvalLevel: idObj.approvalLevel,
      approverAddress: idObj.approverAddress,
      amountTrackerId: idObj.amountTrackerId,
      trackerType: idObj.trackerType,
      approvedAddress: idObj.approvedAddress,
      numTransfers: 0,
      amounts: [],
    };
  }));

  return docs;

}

export async function executeCollectionApprovalsTrackersQuery(collectionId: string, bookmark?: string) {
  const approvalsTrackersRes = await ApprovalsTrackerModel.find({
    collectionId: Number(collectionId),
  }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();


  return {
    docs: approvalsTrackersRes,
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: approvalsTrackersRes.length === 25,
    }
  }
}