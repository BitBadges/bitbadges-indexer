import { GetBadgeActivityRouteResponse, NumberType, Stringify, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { ANNOUNCEMENTS_DB, APPROVALS_TRACKER_DB, BALANCES_DB, MERKLE_CHALLENGES_DB, REVIEWS_DB, TRANSFER_ACTIVITY_DB } from "../db/db";
import { removeCouchDBDetails } from "../utils/couchdb-utils";
import { ApprovalTrackerIdDetails } from "bitbadgesjs-proto";

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
  //This can potentially be optimized in the future (not sure how; views require emitting id.start to id.end 


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
  const res = await BALANCES_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      },
      balances: {
        $gt: null
      },
      //equals total or mint
      cosmosAddress: {
        $or: [
          {
            $eq: 'Total'
          },
          {
            $eq: 'Mint'
          }
        ]
      }
    },
  });


  return res;
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

export async function executeMerkleChallengeByIdsQuery(collectionId: string, challengeIdsToFetch: string[]) {
  const claimsRes = await MERKLE_CHALLENGES_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      },
      challengeId: {
        $in: challengeIdsToFetch
      }
    },
  });

  return claimsRes;
}

export async function executeApprovalsTrackersByIdsQuery(collectionId: string, idsToFetch: ApprovalTrackerIdDetails<bigint>[]) {
  //TODO: Optimize this query because it isn't quite correct.


  const docs = [];

  for (const idObj of idsToFetch) {
    const res = await APPROVALS_TRACKER_DB.partitionedFind(collectionId, {
      selector: {
        collectionId: {
          $eq: Number(collectionId)
        },
        approvalLevel: {
          $eq: idObj.approvalLevel
        },
        approverAddress: {
          $eq: idObj.approverAddress
        },
        approvalId: {
          $eq: idObj.approvalId
        },
        trackerType: {
          $eq: idObj.trackerType
        },
        approvedAddress: {
          $eq: idObj.approvedAddress
        },
      },
      limit: 1,
    });

    docs.push(...res.docs);
  }

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