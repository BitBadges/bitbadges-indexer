import { GetBadgeActivityRouteResponse, MerkleChallengeTrackerIdDetails, NumberType, Stringify, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { ANNOUNCEMENTS_DB, APPROVALS_TRACKER_DB, BALANCES_DB, MERKLE_CHALLENGES_DB, REVIEWS_DB, TRANSFER_ACTIVITY_DB } from "../db/db";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { AmountTrackerIdDetails } from "bitbadgesjs-proto";

export async function executeBadgeActivityQuery(collectionId: string, badgeId: string, bookmark?: string): Promise<GetBadgeActivityRouteResponse<NumberType>> {
  //Check if badgeId > Number.MAX_SAFE_INTEGER
  //If so, we need to do a string query because it is saved in DB as a string
  //Otherwise, we can do a number query

  const totalSupplys = await BALANCES_DB.get(`${collectionId}:Total`);

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

  const activityRes = await TRANSFER_ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      timestamp: {
        "$gt": null,
      },
      "balances": {
        "$elemMatch": {
          "badgeIds": {
            "$elemMatch": {
              "$and": [
                {
                  "start": {
                    "$and": [
                      {
                        "$lte": Number(badgeId),
                      },
                      {
                        "$type": "number"
                      }
                    ]
                  }
                },
                {
                  "end": {
                    "$and": [
                      {
                        "$gte": Number(badgeId),
                      },
                      {
                        "$type": "number"
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });


  return {
    activity: activityRes.docs.map(x => convertTransferActivityDoc(x, Stringify)).map(removeCouchDBDetails),
    pagination: {
      bookmark: bookmark ? bookmark : '',
      hasMore: activityRes.docs.length === 25,
    }
  }
}

export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string) {
  //This can potentially be optimized in the future with a view 
  const activityRes = await TRANSFER_ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      timestamp: {
        "$gt": null,
      },
      "balances": {
        "$gt": null
      },
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return activityRes;
}

export async function executeCollectionAnnouncementsQuery(collectionId: string, bookmark?: string) {
  const announcementsRes = await ANNOUNCEMENTS_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return announcementsRes;
}

export async function executeCollectionReviewsQuery(collectionId: string, bookmark?: string) {
  const reviewsRes = await REVIEWS_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return reviewsRes;
}

export async function fetchTotalAndUnmintedBalancesQuery(collectionId: string) {
  const totalPromise = BALANCES_DB.get(`${collectionId}:Total`);
  const mintPromise = BALANCES_DB.get(`${collectionId}:Mint`);

  const [totalDoc, mintDoc] = await Promise.all([totalPromise, mintPromise]);

  return { docs: [totalDoc, mintDoc] };
}

export async function executeCollectionBalancesQuery(collectionId: string, bookmark?: string) {
  const balancesRes = await BALANCES_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      },
      balances: {
        $gt: null
      }
    },
    bookmark: bookmark ? bookmark : undefined,
  });

  return balancesRes;
}

export async function executeCollectionMerkleChallengesQuery(collectionId: string, bookmark?: string) {
  const claimsRes = await MERKLE_CHALLENGES_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      },
    },
    bookmark: bookmark ? bookmark : undefined,
  });

  return claimsRes;
}

export async function executeMerkleChallengeByIdsQuery(collectionId: string, challengeIdsToFetch: MerkleChallengeTrackerIdDetails<NumberType>[]) {
  if (challengeIdsToFetch.length > 100) {
    throw new Error("You can only fetch up to 100 merkle challenges at a time.");
  }
  const docs = await Promise.all(challengeIdsToFetch.map(async (idObj) => {
    const docId = `${collectionId}:${idObj.challengeLevel}-${idObj.approverAddress}-${idObj.challengeId}`;
    const res = await MERKLE_CHALLENGES_DB.get(docId).catch(catch404);

    return res ?? {
      _id: docId,
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
    const res = await APPROVALS_TRACKER_DB.get(docId).catch(catch404);

    return res ?? {
      _id: docId,
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
  const res = await APPROVALS_TRACKER_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      },
    },
    bookmark: bookmark ? bookmark : undefined,
  });

  return res;
}