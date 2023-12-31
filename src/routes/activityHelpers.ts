import { AmountTrackerIdDetails } from "bitbadgesjs-proto";
import { ChallengeTrackerIdDetails, GetBadgeActivityRouteResponse, NumberType, Stringify, convertToCosmosAddress, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { ApprovalsTrackerModel, BalanceModel, MerkleChallengeModel, ReviewModel, TransferActivityModel, getFromDB, mustGetFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import mongoose from "mongoose";
const pageSize = 25;

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

  const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, bookmark, 'timestamp', '_id');

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
    },
    ...paginationParams,
  };


  let mongoQuery = TransferActivityModel.find(query).sort({ timestamp: -1, _id: -1 }).limit(pageSize).lean();
  const docs = await mongoQuery.exec();

  const activity = docs.map(x => convertTransferActivityDoc(x, Stringify));
  return {
    activity: activity,
    pagination: getPaginationInfoToReturn(docs),
  };
}


export const getPaginationInfoToReturn = (docs: any[]) => {
  const newBookmark = (docs.length > 0 ? docs[docs.length - 1]._id.toString() : undefined);
  return {
    bookmark: newBookmark ?? '',
    hasMore: docs.length === pageSize,
  }
}

//A little naive bc we always assume descending (-1) sort order
//But basically what this does is ensures the query starts at the last fetched doc + 1
//If we have duplicate primary sort fields, we need to handle based on the secondary sort field
export const getQueryParamsFromBookmark = async (model: mongoose.Model<any>, bookmark: string | undefined, primarySort: string, secondarySort?: string) => {
  let lastFetchedDoc: any = null;
  if (bookmark) {
    lastFetchedDoc = await model.findOne({ _id: bookmark }).lean().exec();
  }

  if (secondarySort) {
    return {
      $or: lastFetchedDoc ? [
        {
          [primarySort]: { $eq: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] },
          [secondarySort]: { $lt: lastFetchedDoc[secondarySort as keyof typeof lastFetchedDoc] },
        }, {
          [primarySort]: { $lt: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] }
        }
      ] : [{
        [primarySort]: { $exists: true },
      }],
    }
  } else {
    return {
      [primarySort]: lastFetchedDoc ? { $lt: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] } : { $exists: true },
    }
  }
}


export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string) {

  const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, bookmark, 'timestamp', '_id');

  //Little weird but this is to handle duplicate timestamped logic
  //We want to fetch all docs with the same timestamp as the last fetched do (but greater than the same ID)
  let query = TransferActivityModel.find({
    collectionId: Number(collectionId),
    ...paginationParams,
  }).sort({ timestamp: -1, _id: -1 });


  const activityRes = await query.limit(pageSize).lean().exec();
  return {
    docs: activityRes.map(x => convertTransferActivityDoc(x, Stringify)),
    pagination: getPaginationInfoToReturn(activityRes),
  }
}


export async function executeCollectionAnnouncementsQuery(collectionId: string, bookmark?: string) {
  //Keeping this here for now but we do not use this anymore
  return {
    docs: [],
    pagination: getPaginationInfoToReturn([]),
  }
}

export async function executeCollectionReviewsQuery(collectionId: string, bookmark?: string) {
  const paginationParams = await getQueryParamsFromBookmark(ReviewModel, bookmark, 'timestamp', '_id');

  const reviewsRes = await ReviewModel.find({
    collectionId: Number(collectionId),
    ...paginationParams,
  }).sort({ timestamp: -1, _id: -1 }).limit(pageSize).lean().exec();

  return {
    docs: reviewsRes.filter(x => complianceDoc?.accounts.reported.find(y => y.cosmosAddress === convertToCosmosAddress(x.from)) === undefined),
    pagination: getPaginationInfoToReturn(reviewsRes),
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
  const paginationParams = await getQueryParamsFromBookmark(BalanceModel, bookmark, '_id');

  const balancesRes = await BalanceModel.find({
    collectionId: Number(collectionId),
    ...paginationParams,
  }).sort({ _id: 1 }).limit(pageSize).lean().exec();

  return {
    docs: balancesRes,
    pagination: getPaginationInfoToReturn(balancesRes),
  }
}

export async function executeCollectionMerkleChallengesQuery(collectionId: string, bookmark?: string) {
  const paginationParams = await getQueryParamsFromBookmark(MerkleChallengeModel, bookmark, '_id');

  const merkleChallengesRes = await MerkleChallengeModel.find({
    collectionId: Number(collectionId),
    ...paginationParams,
  }).limit(pageSize).sort({ _id: 1 }).lean().exec();

  return {
    docs: merkleChallengesRes,
    pagination: getPaginationInfoToReturn(merkleChallengesRes),
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
  const paginationParams = await getQueryParamsFromBookmark(ApprovalsTrackerModel, bookmark, '_id');

  const approvalsTrackersRes = await ApprovalsTrackerModel.find({
    collectionId: Number(collectionId),
    ...paginationParams,
  }).limit(pageSize).sort({ _id: 1 }).lean().exec();

  return {
    docs: approvalsTrackersRes,
    pagination: getPaginationInfoToReturn(approvalsTrackersRes),
  }
}