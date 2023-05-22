import { s_Account, s_BitBadgesUserInfo, s_Coin, s_Profile } from "bitbadgesjs-utils";
import { ACTIVITY_DB, AIRDROP_DB, BALANCES_DB } from "../db/db";
import { client } from "../indexer";
import { getEnsDetails, getEnsResolver, getNameForAddress } from "../utils/ensResolvers";

export const convertToBitBadgesUserInfo = async (profileInfos: s_Profile[], accountInfos: s_Account[]): Promise<s_BitBadgesUserInfo[]> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    promises.push(getNameAndAvatar(cosmosAccountInfo.address));
    promises.push(client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(AIRDROP_DB.head(cosmosAccountInfo.cosmosAddress).then(() => true).catch((e) => {
      if (e.statusCode === 404) {
        return false;
      }
      return true;
    }));
  }

  const results = await Promise.all(promises);
  const resultsToReturn: s_BitBadgesUserInfo[] = [];

  for (let i = 0; i < results.length; i += 3) {
    const profileInfo = profileInfos[i / 3];
    const accountInfo = accountInfos[i / 3];

    const nameAndAvatarRes = results[i] as { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as s_Coin;
    const airdropInfo = results[i + 2] as boolean;

    resultsToReturn.push({
      ...profileInfo,
      ...nameAndAvatarRes,
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


export async function getNameAndAvatar(address: string) {
  try {
    const ensName = await getNameForAddress(address);
    let details: { avatar?: string } = {};
    if (ensName) {
      const resolver = await getEnsResolver(ensName);
      if (resolver) {
        details = await getEnsDetails(resolver);
      }
    }
    return { avatar: details.avatar, resolvedName: ensName };
  } catch (e) {
    return { resolvedName: '', avatar: '' };
  }
}


export async function executeActivityQuery(cosmosAddress: string, bookmark?: string) {
  const activityRes = await ACTIVITY_DB.find({
    selector: {
      "to": {
        "$elemMatch": cosmosAddress,
      },
      "from": {
        "$elemMatch": cosmosAddress,
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

export async function getAllCollectionIdsOwned(cosmosAddress: string) {
  const designDocName = '_design/balances_by_address';
  const viewName = 'byCosmosAddress';

  const docs = await BALANCES_DB.view(designDocName, viewName, { limit: 0 });
  const collections = docs.rows.map((row) => row.id.split(':')[1]);
  return collections;
}


export async function executeAnnouncementsQuery(cosmosAddress: string, bookmark?: string) {
  const collections: string[] = await getAllCollectionIdsOwned(cosmosAddress);


  const announcementsRes = await ACTIVITY_DB.find({
    selector: {
      "collectionId": {
        "$in": collections,
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

