import { AnnouncementActivityItem, TransferActivityItem, ReviewActivityItem, BalanceDocument, ClaimDocument } from "bitbadgesjs-utils";
import nano from "nano";
import { ACTIVITY_DB, BALANCES_DB, CLAIMS_DB } from "../db/db";

export async function executeCollectionActivityQuery(collectionId: string, bookmark?: string, badgeId?: string) {
  const activityRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      method: {
        "$or": [
          {
            "$eq": "Transfer"
          },
          {
            "$eq": "Mint"
          },
          {
            "$eq": "Claim"
          }
        ]
      },
      timestamp: {
        "$gt": null,
      },
      //This can potentially be optimized in the future (not sure how; views require emitting id.start to id.end 
      //which would be inefficient for this query; imagine if there were 10000000s of badges in a collection)
      //For now, partitionedFind like this should be efficient enough as it will only have to scan through
      //the collection's balances
      "balances": badgeId ? {
        "$elemMatch": {
          "badgeIds": {
            "$elemMatch": {
              "$and": [
                {
                  "start": {
                    "$lte": Number(badgeId)
                  }
                },
                {
                  "end": {
                    "$gte": Number(badgeId)
                  }
                }
              ]
            }
          }
        }
      } : {
        "$gt": null
      },
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

  return activityRes;
}

export async function executeCollectionAnnouncementsQuery(collectionId: string, bookmark?: string) {
  const announcementsRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      method: {
        $eq: 'Announcement'
      },
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

  return announcementsRes;
}

export async function executeCollectionReviewsQuery(collectionId: string, bookmark?: string) {
  const reviewsRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
    selector: {
      method: {
        $eq: 'Review'
      },
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

  return reviewsRes;
}

export async function executeCollectionBalancesQuery(collectionId: string, bookmark?: string) {
  const balancesRes = await BALANCES_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: collectionId
      },
      balances: {
        $gt: null
      }
    },
    bookmark: bookmark ? bookmark : undefined,
  }) as nano.MangoResponse<BalanceDocument>;

  return balancesRes;
}

export async function executeCollectionClaimsQuery(collectionId: string, bookmark?: string) {
  const claimsRes = await CLAIMS_DB.partitionedFind(collectionId, {
    selector: {
      collectionId: {
        $eq: collectionId
      }
    },
    bookmark: bookmark ? bookmark : undefined,
  }) as nano.MangoResponse<ClaimDocument>;

  return claimsRes;
}