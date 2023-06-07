import { GetBadgeActivityRouteResponse, Stringify, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { removeCouchDBDetails } from "../utils/couchdb-utils";
import { ANNOUNCEMENTS_DB, BALANCES_DB, CLAIMS_DB, COLLECTIONS_DB, REVIEWS_DB, TRANSFER_ACTIVITY_DB } from "../db/db";

export async function executeBadgeActivityQuery(collectionId: string, badgeId: string, bookmark?: string): Promise<GetBadgeActivityRouteResponse> {
  //Check if badgeId > Number.MAX_SAFE_INTEGER
  //If so, we need to do a string query because it is saved in DB as a string
  //Otherwise, we can do a number query

  const collection = await COLLECTIONS_DB.get(collectionId);
  if (BigInt(collection.nextBadgeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
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
      activity: {
        bookmark: bookmark ? bookmark : '',
        hasMore: activityRes.docs.length === 25,
      }
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

export async function executeCollectionClaimsQuery(collectionId: string, bookmark?: string) {
  const claimsRes = await CLAIMS_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: Number(collectionId)
      }
    },
    bookmark: bookmark ? bookmark : undefined,
  });

  return claimsRes;
}