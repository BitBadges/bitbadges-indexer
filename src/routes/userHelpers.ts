import { Coin } from "bitbadgesjs-provider";
import { AccountDocument, BitBadgesUserInfo } from "bitbadgesjs-utils";
import { AIRDROP_DB, ACTIVITY_DB, BALANCES_DB } from "../db/db";
import { client } from "../indexer";
import { getNameForAddress, getEnsResolver, getEnsDetails } from "../utils/ensResolvers";

export const convertToBitBadgesUserInfo = async (accountInfos: AccountDocument[]): Promise<BitBadgesUserInfo[]> => {
  const promises = [];
  for (const accountInfo of accountInfos) {
    promises.push(appendNameAndAvatarForAccount(accountInfo));
    promises.push(client.getBalance(accountInfo.cosmosAddress, 'badge'));
    promises.push(AIRDROP_DB.head(accountInfo.cosmosAddress).then(() => true).catch((e) => {
      if (e.statusCode === 404) {
        return false;
      }
      return true;
    }));
  }

  const results = await Promise.all(promises);
  const resultsToReturn: BitBadgesUserInfo[] = [];

  for (let i = 0; i < results.length; i += 3) {
    const accountInfo = results[i] as AccountDocument & { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as Coin;
    const airdropInfo = results[i + 2] as boolean;

    resultsToReturn.push({
      ...accountInfo,
      balance: balanceInfo,
      airdropped: airdropInfo,
      collected: [],
      activity: [],
      announcements: [],
      reviews: [],
      pagination: {
        collected: {
          bookmark: '',
          hasMore: true,
        },
        announcements: {
          bookmark: '',
          hasMore: true,
        },
        reviews: {
          bookmark: '',
          hasMore: true,
        },
        activity: {
          bookmark: '',
          hasMore: true,
        }
      }
    });
  }

  return resultsToReturn;
}


export async function appendNameAndAvatarForAccount(account: AccountDocument) {
  try {
    const ensName = await getNameForAddress(account.address);
    let details: { avatar?: string } = {};
    if (ensName) {
      const resolver = await getEnsResolver(ensName);
      if (resolver) {
        details = await getEnsDetails(resolver);
      }
    }
    return { avatar: details.avatar, resolvedName: ensName, ...account, };
  } catch (e) {
    return { resolvedName: '', avatar: '', ...account };
  }
}


export async function executeActivityQuery(accountNum: number, bookmark?: string) {
  const activityRes = await ACTIVITY_DB.find({
    selector: {
      "users": {
        "$elemMatch": {
          "$and": [
            {
              "start": {
                "$lte": Number(accountNum),
              },
              "end": {
                "$gte": Number(accountNum),
              }
            },
          ]
        }
      },
      "method": {
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
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return activityRes;
}

export async function executeAnnouncementsQuery(accountNum: number, bookmark?: string) {
  const announcementsRes = await ACTIVITY_DB.find({
    selector: {
      "users": {
        "$elemMatch": {
          "$and": [
            {
              "start": {
                "$lte": Number(accountNum),
              },
              "end": {
                "$gte": Number(accountNum),
              }
            },
          ]
        }
      },
      "method": {
        "$eq": "Announcement"
      },
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return announcementsRes;
}

export async function executeReviewsQuery(cosmosAddress: string, bookmark?: string) {
  const reviewsRes = await ACTIVITY_DB.partitionedFind(`user-${cosmosAddress}`, {
    selector: {
      "method": {
        "$eq": "Review"
      },
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  return reviewsRes;
}

export async function executeCollectedQuery(cosmosAddress: string, bookmark?: string) {
  const collectedRes = await BALANCES_DB.find({
    selector: {
      "cosmosAddress": {
        "$eq": cosmosAddress,
      },
      "balances": {
        "$elemMatch": {
          "balance": {
            "$gt": 0,
          }
        }
      },
    },
    bookmark: bookmark ? bookmark : undefined
  });

  return collectedRes;
}

