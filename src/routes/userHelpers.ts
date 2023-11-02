import { cosmosToEth } from "bitbadgesjs-address-converter";
import { BigIntify, JSPrimitiveNumberType, Stringify, convertBalance } from "bitbadgesjs-proto";
import { AccountInfoBase, BitBadgesUserInfo, CosmosCoin, ProfileInfoBase, SupportedChain, convertToCosmosAddress, getChainForAddress, isAddressValid, removeUintRangeFromUintRange } from "bitbadgesjs-utils";
import { ADDRESS_MAPPINGS_DB, AIRDROP_DB, ANNOUNCEMENTS_DB, BALANCES_DB, CLAIM_ALERTS_DB, COLLECTIONS_DB, ETH_TX_COUNT_DB, REVIEWS_DB, TRANSFER_ACTIVITY_DB, insertToDB } from "../db/db";
import { OFFLINE_MODE, client } from "../indexer";
import { catch404 } from "../utils/couchdb-utils";
import { getEnsDetails, getEnsResolver, getNameForAddress, provider } from "../utils/ensResolvers";

const QUERY_TIME_MODE = false;

export const convertToBitBadgesUserInfo = async (profileInfos: ProfileInfoBase<JSPrimitiveNumberType>[], accountInfos: AccountInfoBase<JSPrimitiveNumberType>[], fetchName = true): Promise<BitBadgesUserInfo<JSPrimitiveNumberType>[]> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  fetchName = false;

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    let isMint = accountInfos[i].cosmosAddress === 'Mint';
    promises.push(isMint || OFFLINE_MODE || !fetchName ? { resolvedName: '' } : getNameAndAvatar(cosmosAccountInfo.ethAddress));
    promises.push(isMint || OFFLINE_MODE ? { amount: '0', denom: 'badge' } : client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(isMint ? undefined : AIRDROP_DB.get(cosmosAccountInfo.cosmosAddress).catch(catch404))
    promises.push(isMint ? async () => {
      return { address: cosmosAccountInfo.cosmosAddress, chain: SupportedChain.UNKNOWN }
    } : async () => {
      const address = cosmosAccountInfo.cosmosAddress;
      const profileDoc = profileInfos[i];

      if (!isAddressValid(address)) {
        return {
          address: '',
          chain: SupportedChain.UNKNOWN
        }
      }


      //If we have a public key, we can determine the chain from that
      let ethTxCount = 0;
      if (cosmosAccountInfo.publicKey && cosmosAccountInfo.chain !== SupportedChain.UNKNOWN) {
        return {
          address: cosmosAccountInfo.chain === SupportedChain.ETH ? cosmosAccountInfo.ethAddress : cosmosAccountInfo.cosmosAddress,
          chain: cosmosAccountInfo.chain
        }
      }

      //If we have a latestSignedInChain, we can determine the chain from that
      const ethAddress = getChainForAddress(address) === SupportedChain.ETH ? address : cosmosToEth(address);
      if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.ETH) {
        return {
          address: ethAddress,
          chain: SupportedChain.ETH
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.COSMOS) {
        return {
          address: getChainForAddress(address) === SupportedChain.COSMOS ? address : convertToCosmosAddress(address),
          chain: SupportedChain.COSMOS
        }
      }

      //If we have neither, we can check if they have any transactions on the ETH chain
      const cachedEthTxCount = await ETH_TX_COUNT_DB.get(ethAddress).catch(catch404);
      if (cachedEthTxCount && cachedEthTxCount.count) {
        return { address: ethAddress, chain: SupportedChain.ETH }
      } else if (!cachedEthTxCount || (cachedEthTxCount && cachedEthTxCount.lastFetched < Date.now() - 1000 * 60 * 60 * 24)) {
        ethTxCount = await provider.getTransactionCount(ethAddress);

        await insertToDB(ETH_TX_COUNT_DB, {
          ...cachedEthTxCount,
          _id: ethAddress,
          count: ethTxCount,
          lastFetched: Date.now(),
        });
      }

      //Else, we 
      return {
        address: ethTxCount > 0 ? ethAddress : address,
        chain: ethTxCount > 0 ? SupportedChain.ETH : getChainForAddress(address),
      }
    });
  }



  const results = await Promise.all(promises.map((promise) => {
    if (typeof promise === 'function') {
      return promise();
    } else {
      return promise;
    }
  }));

  const resultsToReturn: BitBadgesUserInfo<JSPrimitiveNumberType>[] = [];

  for (let i = 0; i < results.length; i += 4) {
    const profileInfo = profileInfos[i / 4];
    const accountInfo = accountInfos[i / 4];

    const nameAndAvatarRes = results[i] as { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as CosmosCoin<JSPrimitiveNumberType>;
    const airdropInfo = results[i + 2] as { _id: string, airdropped: boolean } | undefined;
    const chainResolve = results[i + 3] as { address: string, chain: SupportedChain }

    resultsToReturn.push({
      ...profileInfo,
      ...nameAndAvatarRes,
      ...accountInfo,
      address: chainResolve.address,
      chain: chainResolve.chain,

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
export async function executeActivityQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('activityQuery');

  const onlyShowApproved = profileInfo.onlyShowApproved;
  const hiddenBadges = profileInfo.hiddenBadges ?? [];
  const shownBadges = profileInfo.shownBadges ?? [];

  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await TRANSFER_ACTIVITY_DB.view(activityDesignDocName, 'byCosmosAddress', { key: cosmosAddress, include_docs: true, limit: 25, skip: Number(currBookmark) ?? 0 });

    let viewDocs = view.rows.map((row) => {
      return {
        ...row.doc,
        to: row.doc?.to.includes(cosmosAddress) ? [cosmosAddress] : row.doc?.to //For the user queries, we don't need to return all the to addresses
      }
    })

    if (!fetchHidden) {
      if (onlyShowApproved) {
        const nonHiddenDocs = viewDocs.map((doc) => {
          if (!doc || !shownBadges || !doc.balances || !doc.collectionId) return undefined;
          const matchingShownBadge = shownBadges.find(x => doc.collectionId && x.collectionId == BigInt(doc.collectionId));
          if (!matchingShownBadge) return undefined;

          return {
            ...doc,
            balances: doc.balances.map(x => convertBalance(x, BigIntify)).map((balance) => {

              const [, removed] = removeUintRangeFromUintRange(matchingShownBadge.badgeIds, balance.badgeIds);
              return {
                ...balance,
                badgeIds: removed
              }
            }
            ).filter((balance) => balance.badgeIds.length > 0).map(x => convertBalance(x, Stringify))
          }
        }).filter((doc) => doc !== undefined && doc.balances.length > 0);
        viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._id === doc._id));
      } else {
        const nonHiddenDocs = viewDocs.map((doc) => {
          if (!doc || !hiddenBadges || !doc.balances || !doc.collectionId) return undefined;
          let matchingHiddenBadge = hiddenBadges.find(x => doc.collectionId && x.collectionId == BigInt(doc.collectionId)) ?? {
            collectionId: BigInt(doc.collectionId),
            badgeIds: []
          }

          return {
            ...doc,
            balances: doc.balances.map(x => convertBalance(x, BigIntify)).map((balance) => {
              const [remaining,] = removeUintRangeFromUintRange(matchingHiddenBadge.badgeIds, balance.badgeIds);
              return {
                ...balance,
                badgeIds: remaining
              }
            }
            ).filter((balance) => balance.badgeIds.length > 0).map(x => convertBalance(x, Stringify))
          }
        }).filter((doc) => doc !== undefined && doc.balances.length > 0);

        viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._id === doc._id));
      }
    }

    //We rely on the fact docs length == 25 so we

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = JSON.stringify(Number(currBookmark) + view.rows.length);

    if (viewDocs.length === 0) {
      break;
    }
  }

  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }

  if (QUERY_TIME_MODE) console.timeEnd('activityQuery');
  return collectedRes;
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

export async function executeCollectedQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeCollectedQuery');
  //keep searching until we have min 25 non-hidden docs

  const onlyShowApproved = profileInfo.onlyShowApproved;
  const hiddenBadges = profileInfo.hiddenBadges ?? [];
  const shownBadges = profileInfo.shownBadges ?? [];

  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await BALANCES_DB.view(designDocName, 'byCosmosAddress', { key: cosmosAddress, include_docs: true, limit: 25, skip: Number(currBookmark) ?? 0 });

    let viewDocs = view.rows.map((row) => row.doc);
    if (!fetchHidden) {
      if (onlyShowApproved) {
        const nonHiddenDocs = viewDocs.map((doc) => {
          if (!doc || !shownBadges) return undefined;
          const matchingShownBadge = shownBadges.find(x => x.collectionId == BigInt(doc.collectionId));
          if (!matchingShownBadge) return undefined;

          return {
            ...doc,
            balances: doc.balances.map(x => convertBalance(x, BigIntify)).map((balance) => {

              const [, removed] = removeUintRangeFromUintRange(matchingShownBadge.badgeIds, balance.badgeIds);
              return {
                ...balance,
                badgeIds: removed
              }
            }
            ).filter((balance) => balance.badgeIds.length > 0).map(x => convertBalance(x, Stringify))
          }
        }).filter((doc) => doc !== undefined && doc.balances.length > 0);
        viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._id === doc._id));
      } else {
        const nonHiddenDocs = viewDocs.map((doc) => {
          if (!doc || !hiddenBadges) return undefined;
          let matchingHiddenBadge = hiddenBadges.find(x => x.collectionId == BigInt(doc.collectionId)) ?? {
            collectionId: BigInt(doc.collectionId),
            badgeIds: []
          }

          return {
            ...doc,
            balances: doc.balances.map(x => convertBalance(x, BigIntify)).map((balance) => {
              const [remaining,] = removeUintRangeFromUintRange(matchingHiddenBadge.badgeIds, balance.badgeIds);
              return {
                ...balance,
                badgeIds: remaining
              }
            }
            ).filter((balance) => balance.badgeIds.length > 0).map(x => convertBalance(x, Stringify))
          }
        }).filter((doc) => doc !== undefined && doc.balances.length > 0);

        viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._id === doc._id));
      }
    }

    //We rely on the fact docs length == 25 so we

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = JSON.stringify(Number(currBookmark) + view.rows.length);

    if (viewDocs.length === 0) {
      break;
    }
  }
  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }

  if (QUERY_TIME_MODE) console.timeEnd('executeCollectedQuery');
  return collectedRes;
}

export async function executeListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeListsQuery');
  const collectedRes = await ADDRESS_MAPPINGS_DB.find({
    selector: {
      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
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


export async function executeManagingQuery(cosmosAddress: string, bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeManagingQuery');
  //keep searching until we have min 25 non-hidden docs
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await COLLECTIONS_DB.view('managers', 'byManager', { key: cosmosAddress, limit: 25, skip: Number(currBookmark) ?? 0 });

    let viewDocs = view.rows.map((row) => row.id);

    //TODO: Handle hidden?

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = JSON.stringify(Number(currBookmark) + view.rows.length);

    if (viewDocs.length === 0) {
      break;
    }
  }

  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }

  if (QUERY_TIME_MODE) console.timeEnd('executeManagingQuery');
  return collectedRes;
}

export async function executeCreatedByQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeCreatedByQuery');
  //keep searching until we have min 25 non-hidden docs
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await COLLECTIONS_DB.view('created_by', 'byCreator', { key: cosmosAddress, limit: 25, skip: Number(currBookmark) ?? 0 });

    let viewDocs = view.rows.map((row) => row.id);

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = JSON.stringify(Number(currBookmark) + view.rows.length);

    if (viewDocs.length === 0) {
      break;
    }
  }

  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }

  if (QUERY_TIME_MODE) console.timeEnd('executeCreatedByQuery');
  return collectedRes;
}