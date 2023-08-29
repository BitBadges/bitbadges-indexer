import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, BitBadgesUserInfo, CosmosCoin, ProfileInfoBase } from "bitbadgesjs-utils";
import { ADDRESS_MAPPINGS_DB, AIRDROP_DB, ANNOUNCEMENTS_DB, BALANCES_DB, CLAIM_ALERTS_DB, REVIEWS_DB, TRANSFER_ACTIVITY_DB } from "../db/db";
import { OFFLINE_MODE, client } from "../indexer";
import { getEnsDetails, getEnsResolver, getNameForAddress } from "../utils/ensResolvers";
import { catch404 } from "../utils/couchdb-utils";

const QUERY_TIME_MODE = true;

export const convertToBitBadgesUserInfo = async (profileInfos: ProfileInfoBase<JSPrimitiveNumberType>[], accountInfos: AccountInfoBase<JSPrimitiveNumberType>[], fetchName = true): Promise<BitBadgesUserInfo<JSPrimitiveNumberType>[]> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    let isMint = accountInfos[i].cosmosAddress === 'Mint';
    promises.push(isMint || OFFLINE_MODE || !fetchName ? { resolvedName: '' } : getNameAndAvatar(cosmosAccountInfo.address));
    promises.push(isMint || OFFLINE_MODE ? { amount: '0', denom: 'badge' } : client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(AIRDROP_DB.get(cosmosAccountInfo.cosmosAddress).catch(catch404))
  }
  const results = await Promise.all(promises);

  const resultsToReturn: BitBadgesUserInfo<JSPrimitiveNumberType>[] = [];

  for (let i = 0; i < results.length; i += 3) {
    const profileInfo = profileInfos[i / 3];
    const accountInfo = accountInfos[i / 3];

    const nameAndAvatarRes = results[i] as { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as CosmosCoin<JSPrimitiveNumberType>;
    const airdropInfo = results[i + 2] as { _id: string, airdropped: boolean } | undefined;

    resultsToReturn.push({
      ...profileInfo,
      ...nameAndAvatarRes,
      ...accountInfo,

      balance: balanceInfo,
      airdropped: airdropInfo && airdropInfo.airdropped,
      fetchedProfile: true,

      collected: [],
      activity: [],
      addressMappings: [],
      announcements: [],
      reviews: [],
      merkleChallenges: [],
      claimAlerts: [],
      approvalsTrackers: [],
      views: {},
      //We don't want to return these to the user
      _id: accountInfo.cosmosAddress,
      _rev: undefined,
    } as BitBadgesUserInfo<JSPrimitiveNumberType>);
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
    console.log(e);
    return { resolvedName: '', avatar: '' };
  }
}

const activityDesignDocName = 'transfer_activity_by_address';
export async function executeActivityQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('activityQuery');

  const view = await TRANSFER_ACTIVITY_DB.view(activityDesignDocName, 'byCosmosAddress', { key: cosmosAddress, include_docs: true, limit: 25, skip: Number(bookmark) ?? 0 });

  const res = {
    docs: view.rows.map((row) => {
      return {
        ...row.doc,
        to: row.doc?.to.includes(cosmosAddress) ? [cosmosAddress] : row.doc?.to //For the user queries, we don't need to return all the to addresses
      }
    }),
    bookmark: JSON.stringify(Number(bookmark) + view.rows.length),
  }

  if (QUERY_TIME_MODE) console.timeEnd('activityQuery');

  return res;
}

const designDocName = 'balances_by_address';

export async function getAllCollectionIdsOwned(cosmosAddress: string) {
  if (QUERY_TIME_MODE) console.time('getAllCollectionIdsOwned');

  const view = await BALANCES_DB.view(designDocName, 'byCosmosAddress', { key: cosmosAddress });

  const collections = view.rows.map((row) => row.id.split(':')[0]) ?? [];

  if (QUERY_TIME_MODE) console.timeEnd('getAllCollectionIdsOwned');
  return collections;
}


export async function executeAnnouncementsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeAnnouncementsQuery');
  const collections: string[] = await getAllCollectionIdsOwned(cosmosAddress);

  const announcementsRes = await ANNOUNCEMENTS_DB.find({
    selector: {
      "collectionId": {
        "$in": collections.map((collectionId) => Number(collectionId)),
      },
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  if (QUERY_TIME_MODE) console.timeEnd('executeAnnouncementsQuery');
  return announcementsRes;
}

export async function executeReviewsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeReviewsQuery');
  const reviewsRes = await REVIEWS_DB.partitionedFind(`user-${cosmosAddress}`, {
    selector: {
      timestamp: {
        "$gt": null,
      }
    },
    sort: ["timestamp"],
    bookmark: bookmark ? bookmark : undefined,
  });

  if (QUERY_TIME_MODE) console.timeEnd('executeReviewsQuery');
  return reviewsRes;
}

export async function executeCollectedQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeCollectedQuery');
  // if (QUERY_TIME_MODE) console.time('view');
  const view = await BALANCES_DB.view(designDocName, 'byCosmosAddress', { key: cosmosAddress, include_docs: true, limit: 25, skip: Number(bookmark) ?? 0 });
  // if (QUERY_TIME_MODE) console.timeEnd('view');
  // console.log(view);

  const collectedRes = {
    docs: view.rows.map((row) => row.doc),
    bookmark: JSON.stringify(Number(bookmark) + view.rows.length),
  }


  if (QUERY_TIME_MODE) console.timeEnd('executeCollectedQuery');
  return collectedRes;
}

export async function executeListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeListsQuery');
  const collectedRes = await ADDRESS_MAPPINGS_DB.find({
    selector: {
      "$or": [
        {
          "$and": [{
            "addresses": {
              "$elemMatch": {
                "$eq": cosmosAddress,
              },
            },
          },
          {
            "includeAddresses": {
              "$eq": true,
            },
          }],
        },
        {
          "$and": [{
            //Is not in the list
            "addresses": {
              "$not": {
                "$elemMatch": {
                  "$eq": cosmosAddress,
                },
              },
            },
          },
          {
            "includeAddresses": {
              "$eq": false,
            },
          }],
        }
      ]
    },
    bookmark: bookmark ? bookmark : undefined
  });


  if (QUERY_TIME_MODE) console.timeEnd('executeListsQuery');
  return collectedRes;
}

export async function executeExplicitIncludedListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitIncluded');
  const collectedRes = await ADDRESS_MAPPINGS_DB.find({
    selector: {
      "$or": [
        {
          "$and": [{
            "addresses": {
              "$elemMatch": {
                "$eq": cosmosAddress,
              },
            },
          },
          {
            "includeAddresses": {
              "$eq": true,
            },
          }],
        }
      ]
    },
    bookmark: bookmark ? bookmark : undefined
  });


  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitIncluded');
  return collectedRes;
}

export async function executeExplicitExcludedListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitExcluded');
  const collectedRes = await ADDRESS_MAPPINGS_DB.find({
    selector: {
      "$or": [
        {
          "$and": [{
            "addresses": {
              "$elemMatch": {
                "$eq": cosmosAddress,
              },
            },
          },
          {
            "includeAddresses": {
              "$eq": false,
            },
          }],
        }
      ]
    },
    bookmark: bookmark ? bookmark : undefined
  });


  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitExcluded');
  return collectedRes;
}

export async function executeLatestAddressMappingsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeLatestAddressMappingsQuery');
  const collectedRes = await ADDRESS_MAPPINGS_DB.find({
    selector: {
      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      lastUpdated: {
        "$gt": null,
      }
    },
    sort: [{ "lastUpdated": "desc" }],
    bookmark: bookmark ? bookmark : undefined
  });


  if (QUERY_TIME_MODE) console.timeEnd('executeLatestAddressMappingsQuery');
  return collectedRes;
}


export async function executeClaimAlertsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeClaimAlertsQuery');
  const view = await CLAIM_ALERTS_DB.view('claim_alerts_by_address', 'byCosmosAddress', { key: cosmosAddress, include_docs: true, limit: 25, skip: Number(bookmark) ?? 0 });

  const collectedRes = {
    docs: view.rows.map((row) => {
      return {
        ...row.doc,
        cosmosAddresses: row.doc?.cosmosAddresses.includes(cosmosAddress) ? [cosmosAddress] : row.doc?.cosmosAddresses //For the user queries, we don't need to return all the to addresses
      }
    }),
    bookmark: JSON.stringify(Number(bookmark) + view.rows.length),
  }

  if (QUERY_TIME_MODE) console.time('executeClaimAlertsQuery');

  return collectedRes;
}