import { BigIntify, NumberType, Stringify, convertBalance } from "bitbadgesjs-proto";
import { AccountInfoBase, BitBadgesUserInfo, CosmosCoin, ProfileDoc, ProfileInfoBase, SupportedChain, cosmosToEth, isAddressValid, removeUintRangeFromUintRange } from "bitbadgesjs-utils";
import { AddressMappingModel, AirdropModel, BalanceModel, BlockinAuthSignatureModel, ClaimAlertModel, CollectionModel, EthTxCountModel, ReviewModel, TransferActivityModel, getFromDB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { OFFLINE_MODE } from "../indexer-vars";
import { complianceDoc } from "../poll";
import { getEnsDetails, getEnsResolver, getNameForAddress, provider } from "../utils/ensResolvers";

const QUERY_TIME_MODE = false;

export const convertToBitBadgesUserInfo = async (profileInfos: ProfileDoc<NumberType>[], accountInfos: AccountInfoBase<NumberType>[], fetchName = true): Promise<BitBadgesUserInfo<NumberType>[]> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    const profileDoc = profileInfos[i];
    let isMint = accountInfos[i].cosmosAddress === 'Mint';

    promises.push(isMint || OFFLINE_MODE || !fetchName || (cosmosAccountInfo.chain !== SupportedChain.ETH && cosmosAccountInfo.publicKey)
      ? { resolvedName: '' } : getNameAndAvatar(cosmosAccountInfo.ethAddress, !!profileDoc.profilePicUrl));
    promises.push(isMint || OFFLINE_MODE ? { amount: '0', denom: 'badge' } : client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(isMint ? undefined : getFromDB(AirdropModel, cosmosAccountInfo.cosmosAddress));
    promises.push(isMint ? async () => {
      return { address: cosmosAccountInfo.cosmosAddress, chain: SupportedChain.UNKNOWN }
    } : async () => {
      const cosmosAddress = cosmosAccountInfo.cosmosAddress;
      const solAddress = (cosmosAccountInfo.solAddress ? cosmosAccountInfo.solAddress : profileDoc?.solAddress ?? "")
      if (!isAddressValid(cosmosAddress)) {
        return {
          address: '',
          chain: SupportedChain.UNKNOWN
        }
      }

      //If we have a public key, we can determine the chain from the pub key type bc it has been previously set and used
      let ethTxCount = 0;
      if (cosmosAccountInfo.publicKey) {
        return {
          address: cosmosAccountInfo.chain === SupportedChain.ETH ? cosmosAccountInfo.ethAddress
            : cosmosAccountInfo.chain === SupportedChain.SOLANA ? solAddress
              : cosmosAccountInfo.cosmosAddress,
          chain: cosmosAccountInfo.chain
        }
      }

      //Else if we have a latestSignedInChain, we can determine the chain from that
      const ethAddress = cosmosToEth(cosmosAccountInfo.cosmosAddress);
      if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.ETH) {
        return {
          address: ethAddress,
          chain: SupportedChain.ETH
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.COSMOS) {
        return {
          address: cosmosAddress,
          chain: SupportedChain.COSMOS
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.SOLANA) {
        return {
          address: solAddress,
          chain: SupportedChain.SOLANA
        }
      }

      //If we have neither, we can check if they have any transactions on the ETH chain
      const cachedEthTxCount = await getFromDB(EthTxCountModel, ethAddress);
      if (cachedEthTxCount && cachedEthTxCount.count) {
        return { address: ethAddress, chain: SupportedChain.ETH }
      } else if (!cachedEthTxCount || (cachedEthTxCount && cachedEthTxCount.lastFetched < Date.now() - 1000 * 60 * 60 * 24)) {
        ethTxCount = await provider.getTransactionCount(ethAddress);

        await insertToDB(EthTxCountModel, {
          ...cachedEthTxCount,
          _legacyId: ethAddress,
          count: ethTxCount,
          lastFetched: Date.now(),
        });
      }

      //Else, we default to whatever the chain was in the original account doc (which is tyically just the format of the requested address in the query)
      let defaultedAddr = cosmosAddress;
      if (accountInfos[i].chain === SupportedChain.ETH) {
        defaultedAddr = ethAddress;
      } else if (accountInfos[i].chain === SupportedChain.SOLANA) {
        defaultedAddr = solAddress;
      }

      //Else, we check ETH txs and default to cosmos address if none
      //Should we support solana or something by default?
      return {
        address: ethTxCount > 0 ? ethAddress : defaultedAddr,
        chain: ethTxCount > 0 ? SupportedChain.ETH : accountInfos[i].chain
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

  const resultsToReturn: BitBadgesUserInfo<NumberType>[] = [];

  for (let i = 0; i < results.length; i += 4) {
    const profileInfo = profileInfos[i / 4];
    const accountInfo = accountInfos[i / 4];

    const nameAndAvatarRes = results[i] as { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as CosmosCoin<NumberType>;
    const airdropInfo = results[i + 2] as { _legacyId: string, airdropped: boolean } | undefined;
    const chainResolve = results[i + 3] as { address: string, chain: SupportedChain }

    const isNSFW = complianceDoc?.accounts.nsfw.find(x => x.cosmosAddress === accountInfo.cosmosAddress);
    const isReported = complianceDoc?.accounts.reported.find(x => x.cosmosAddress === accountInfo.cosmosAddress);

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
      authCodes: [],
      views: {},
      nsfw: isNSFW ? isNSFW : undefined,
      reported: isReported ? isReported : undefined,

      //We don't want to return these to the user
      _legacyId: accountInfo.cosmosAddress,
      _rev: undefined,
    } as BitBadgesUserInfo<NumberType>);
  }

  return resultsToReturn;
}


export async function getNameAndAvatar(address: string, skipAvatarFetch?: boolean) {
  try {
    const ensName = await getNameForAddress(address);

    let details: { avatar?: string } = {};
    if (ensName && !skipAvatarFetch) {
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

export async function executeActivityQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('activityQuery');

  const hiddenBadges = [...profileInfo.hiddenBadges ?? [], ...complianceDoc?.badges.reported ?? []];
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await TransferActivityModel.find({
      "$or": [
        {
          "from": cosmosAddress,
        },
        {
          "to": {
            "$elemMatch": {
              "$eq": cosmosAddress,
            },
          },
        },
      ],
    }).sort({ timestamp: -1 }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();



    let viewDocs = view.map((doc) => {
      return {
        ...doc,
        to: doc?.to.includes(cosmosAddress) ? [cosmosAddress] : doc?.to //For the user queries, we don't need to return all the to addresses
      }
    })

    if (!fetchHidden) {
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
      }).filter((doc) => doc !== undefined);

      viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._legacyId === doc._legacyId));
    }


    //We rely on the fact docs length == 25 so we

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

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


export async function executeAnnouncementsQuery(cosmosAddress: string, bookmark?: string) {
  return {
    docs: [],
    pagination: {
      bookmark: '',
      hasMore: false,
    }
  }
}

export async function executeReviewsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeReviewsQuery');
  const reviewsRes = await ReviewModel.find({
    _legacyId: {
      "$regex": `^user-${cosmosAddress}:`,
    }
  }).sort({ timestamp: -1 }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  if (QUERY_TIME_MODE) console.timeEnd('executeReviewsQuery');
  return {
    docs: reviewsRes,
    pagination: {
      bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
      hasMore: reviewsRes.length === 25,
    }
  }
}

export async function executeCollectedQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeCollectedQuery');
  //keep searching until we have min 25 non-hidden docs

  const hiddenBadges = [...profileInfo.hiddenBadges ?? [], ...complianceDoc?.badges.reported ?? []];

  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    let viewDocs = await BalanceModel.find({
      cosmosAddress: cosmosAddress,
      balances: {
        "$elemMatch": {
          "amount": {
            "$gt": 0,
          }
        }
      }
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();

    if (!fetchHidden) {
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

      viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._legacyId === doc._legacyId));
    }

    //We rely on the fact docs length == 25 so we

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

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
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const collectedRes = await AddressMappingModel.find({

      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      private: {
        "$ne": true,
      }
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();


    docs.push(...collectedRes.filter((doc) => complianceDoc?.addressMappings?.reported?.find((reported) => reported.mappingId === doc.mappingId) === undefined));
    docsLeft -= collectedRes.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

    if (collectedRes.length === 0) {
      break;
    }
  }

  if (QUERY_TIME_MODE) console.timeEnd('executeListsQuery');
  return {
    docs: docs,
    bookmark: currBookmark,
  }
}

export async function executeExplicitIncludedListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitIncluded');
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const collectedRes = await AddressMappingModel.find({

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
      ],
      private: {
        "$ne": true,
      }
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();

    docs.push(...collectedRes.filter((doc) => complianceDoc?.addressMappings?.reported?.find((reported) => reported.mappingId === doc.mappingId) === undefined));
    docsLeft -= collectedRes.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

    if (collectedRes.length === 0) {
      break;
    }

  }

  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }


  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitIncluded');
  return collectedRes;
}

export async function executeExplicitExcludedListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitExcluded');
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const collectedRes = await AddressMappingModel.find({

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
      ],
      private: {
        "$ne": true,
      }
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();

    docs.push(...collectedRes.filter((doc) => complianceDoc?.addressMappings?.reported?.find((reported) => reported.mappingId === doc.mappingId) === undefined));
    docsLeft -= collectedRes.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

    if (collectedRes.length === 0) {
      break;
    }

  }


  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }


  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitExcluded');
  return collectedRes;
}

export async function executeLatestAddressMappingsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeLatestAddressMappingsQuery');
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {


    const collectedRes = await AddressMappingModel.find({

      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      private: {
        "$ne": true,
      }


    }).sort({ lastUpdated: -1 }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();

    docs.push(...collectedRes.filter((doc) => complianceDoc?.addressMappings?.reported?.find((reported) => reported.mappingId === doc.mappingId) === undefined));
    docsLeft -= collectedRes.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

    if (collectedRes.length === 0) {
      break;
    }
  }

  const collectedRes = {
    docs: docs,
    bookmark: currBookmark,
  }

  if (QUERY_TIME_MODE) console.timeEnd('executeLatestAddressMappingsQuery');
  return collectedRes;
}


export async function executeClaimAlertsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeClaimAlertsQuery');
  const view = await ClaimAlertModel.find({
    cosmosAddresses: {
      "$elemMatch": {
        "$eq": cosmosAddress,
      },
    },
  }).sort({ createdTimestamp: -1 }).limit(25).skip(bookmark ? 25 * Number(bookmark) : 0).lean().exec();

  const collectedRes = {
    docs: view.map((row) => {
      return {
        ...row,
        cosmosAddresses: row?.cosmosAddresses.includes(cosmosAddress) ? [cosmosAddress] : row?.cosmosAddresses //For the user queries, we don't need to return all the to addresses
      }
    }),
    bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
  }

  if (QUERY_TIME_MODE) console.time('executeClaimAlertsQuery');

  return collectedRes;
}


export async function executeManagingQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeManagingQuery');
  //keep searching until we have min 25 non-hidden docs
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await CollectionModel.find({
      managerTimeline: {
        "$elemMatch": {
          manager: {
            "$eq": cosmosAddress,
          },
        },
      },
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();


    let viewDocs = view.map((row) => row._legacyId);

    //TODO: Make this more robust. Should we be filtering only if they hide whole collection (all badge IDs) or minimum of 1?
    viewDocs = viewDocs.filter((doc) => {
      if (profileInfo.hiddenBadges?.find((hiddenBadge) => hiddenBadge.collectionId === BigInt(doc))) {
        return false;
      }

      if (complianceDoc?.badges?.reported?.find((reported) => reported.collectionId === BigInt(doc))) {
        return false;
      }

      return true;
    });


    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

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

export async function executeCreatedByQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeCreatedByQuery');
  //keep searching until we have min 25 non-hidden docs
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  while (docsLeft > 0) {
    const view = await CollectionModel.find({
      createdBy: cosmosAddress
    }).limit(25).skip(currBookmark ? 25 * Number(currBookmark) : 0).lean().exec();

    let viewDocs = view.map((row) => row._legacyId);

    //TODO: Make this more robust. Should we be filtering only if they hide whole collection (all badge IDs) or minimum of 1?
    viewDocs = viewDocs.filter((doc) => {
      if (profileInfo.hiddenBadges?.find((hiddenBadge) => hiddenBadge.collectionId === BigInt(doc))) {
        return false;
      }

      if (complianceDoc?.badges?.reported?.find((reported) => reported.collectionId === BigInt(doc))) {
        return false;
      }

      return true;
    });

    docs.push(...viewDocs);
    docsLeft -= viewDocs.length;

    currBookmark = (currBookmark ? Number(currBookmark) + 1 : 1).toString();

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


export async function executeAuthCodesQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('authCodes');
  const res = await BlockinAuthSignatureModel.find({
    cosmosAddress: cosmosAddress,
  }).lean().exec();


  if (QUERY_TIME_MODE) console.timeEnd('authCodes');
  return {
    docs: res,
    bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
  }
}


export async function executePrivateListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('privateLists');


  const res = await AddressMappingModel.find({
    createdBy: cosmosAddress,
    private: true,
  }).lean().exec();

  //Could filter hidden here but they created it so they should be able to see it


  if (QUERY_TIME_MODE) console.timeEnd('privateLists');
  return {
    docs: res,
    bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
  }
}

export async function executeCreatedListsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('createdLists');


  const res = await AddressMappingModel.find({
    createdBy: cosmosAddress,
    private: false
  }).lean().exec();
  //Could filter hidden here but they created it so they should be able to see it

  if (QUERY_TIME_MODE) console.timeEnd('createdLists');
  return {
    docs: res,
    bookmark: (bookmark ? Number(bookmark) + 1 : 1).toString(),
  }
}