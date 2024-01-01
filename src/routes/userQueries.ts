

import { BigIntify, JSPrimitiveNumberType, NumberType, Stringify, UintRange, convertBalance } from "bitbadgesjs-proto";
import { BalanceDoc, ProfileInfoBase, TransferActivityDoc, removeUintRangeFromUintRange } from "bitbadgesjs-utils";
import { AddressMappingModel, BalanceModel, BitBadgesDoc, BlockinAuthSignatureModel, ClaimAlertModel, CollectionModel, ListActivityModel, ReviewModel, TransferActivityModel } from "../db/db";
import { complianceDoc } from "../poll";
import { getPaginationInfoToReturn, getQueryParamsFromBookmark } from "./activityHelpers";

const QUERY_TIME_MODE = false;

//Basically queries then filters until we get at least 25 results
//Max tries is 25
export async function queryAndFilter<T extends BitBadgesDoc<JSPrimitiveNumberType>>(bookmark: string | undefined, queryFunc: (bookmark?: string) => Promise<T[]>, filterFunc: (docs: T[]) => Promise<T[]>) {
  let docsLeft = 25;
  let currBookmark = bookmark;
  const docs = [];

  let maxTries = 25;
  while (docsLeft > 0) {
    const queryDocs = await queryFunc(currBookmark);
    currBookmark = queryDocs.length > 0 ? queryDocs[queryDocs.length - 1]._id?.toString() : undefined;
    const filteredDocs = await filterFunc(queryDocs);

    docs.push(...filteredDocs);
    docsLeft -= filteredDocs.length;

    if (filteredDocs.length === 0) {
      break;
    }

    if (maxTries <= 0) {
      throw new Error("Max tries exceeded");
    }

    maxTries--;
  }

  return {
    docs: docs,
    bookmark: currBookmark,
  }
}


export const filterActivityFunc = async (viewDocs: TransferActivityDoc<JSPrimitiveNumberType>[], hiddenBadges: { collectionId: bigint, badgeIds: UintRange<bigint>[] }[]) => {

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
  return viewDocs;
}

export async function executeActivityQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('activityQuery');

  const hiddenBadges = [...profileInfo.hiddenBadges ?? [], ...complianceDoc?.badges.reported ?? []];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, currBookmark, 'timestamp', '_id');

    const view = await TransferActivityModel.find({
      "$or": [
        {
          "from": cosmosAddress,
          ...paginationParams,
        },
        {
          "to": {
            "$elemMatch": {
              "$eq": cosmosAddress,
            },
          },
          ...paginationParams,
        },
      ],
    }).sort({ timestamp: -1, _id: -1 }).limit(25).lean().exec();


    let viewDocs = view.map((doc) => {
      return {
        ...doc,
        to: doc?.to.includes(cosmosAddress) ? [cosmosAddress] : doc?.to //For the user queries, we don't need to return all the to addresses of the doc
      }
    })

    return viewDocs;
  }

  const filterFunc = async (viewDocs: TransferActivityDoc<JSPrimitiveNumberType>[]) => {
    if (!fetchHidden) {
      viewDocs = await filterActivityFunc(viewDocs, hiddenBadges);
    }

    return viewDocs;
  }


  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('activityQuery');
  return collectedRes;
}


export async function executeAnnouncementsQuery(cosmosAddress: string, bookmark?: string) {
  return {
    docs: [],
    pagination: getPaginationInfoToReturn([])
  }
}

export async function executeReviewsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeReviewsQuery');

  const paginationParams = await getQueryParamsFromBookmark(ReviewModel, bookmark, 'timestamp', '_id');

  const reviewsRes = await ReviewModel.find({
    _legacyId: {
      "$regex": `^user-${cosmosAddress}:`,
    },
    ...paginationParams,
  }).sort({ timestamp: -1, _id: -1 }).limit(25).lean().exec();

  if (QUERY_TIME_MODE) console.timeEnd('executeReviewsQuery');
  return {
    docs: reviewsRes,
    pagination: getPaginationInfoToReturn(reviewsRes),
  }
}

export const filterBalanceFunc = async (viewDocs: BalanceDoc<JSPrimitiveNumberType>[], hiddenBadges: { collectionId: bigint, badgeIds: UintRange<bigint>[] }[]) => {
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
  }).filter((doc) => doc !== undefined);

  viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._legacyId === doc._legacyId));

  return viewDocs;
}

export async function executeCollectedQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, filteredCollections?: {
  badgeIds: UintRange<NumberType>[];
  collectionId: NumberType;
}[],
  bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeCollectedQuery');
  //keep searching until we have min 25 non-hidden docs

  const hiddenBadges = [...profileInfo.hiddenBadges ?? [], ...complianceDoc?.badges.reported ?? []];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(BalanceModel, currBookmark, '_id');

    let viewDocs = await BalanceModel.find({
      collectionId: filteredCollections ? { "$in": filteredCollections.map((collection) => Number(collection.collectionId)) } : { "$exists": true },
      cosmosAddress: cosmosAddress,
      balances: {
        "$elemMatch": {
          "amount": {
            "$gt": 0,
          }
        }
      },
      ...paginationParams,

    }).limit(25).sort({ _id: -1 }).lean().exec();

    return viewDocs;
  }

  const filterFunc = async (viewDocs: BalanceDoc<JSPrimitiveNumberType>[]) => {
    if (!fetchHidden) {
      viewDocs = await filterBalanceFunc(viewDocs, hiddenBadges);
    }

    return viewDocs;
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeCollectedQuery');
  return collectedRes;
}

export const filterListsFunc = async (viewDocs: any[]) => {
  return viewDocs.filter((doc) => complianceDoc?.addressMappings?.reported?.find((reported) => reported.mappingId === doc.mappingId) === undefined);
}

export async function executeListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeListsQuery');
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, currBookmark, '_id');

    const view = await AddressMappingModel.find({
      mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      private: {
        "$ne": true,
      },
      ...paginationParams,
    }).sort({ _id: -1 }).limit(25).lean().exec();

    return view;
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeListsQuery');
  return collectedRes;
}


export async function executeExplicitIncludedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitIncluded');

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, currBookmark, '_id');

    const view = await AddressMappingModel.find({
      mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
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
      },
      ...paginationParams,
    }).sort({ _id: -1 }).limit(25).lean().exec();

    return view;
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitIncluded');
  return collectedRes;
}

export async function executeExplicitExcludedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeExplicitExcluded');

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, currBookmark, '_id');

    const view = await AddressMappingModel.find({
      mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
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
      },
      ...paginationParams,
    }).sort({ _id: -1 }).limit(25).lean().exec();

    return view;
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeExplicitExcluded');
  return collectedRes;
}

export async function executeLatestAddressMappingsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeLatestAddressMappingsQuery');
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, currBookmark, 'lastUpdated', '_id');

    const view = await AddressMappingModel.find({
      mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      private: {
        "$ne": true,
      },
      ...paginationParams,
    }).sort({ lastUpdated: -1, _id: -1 }).limit(25).lean().exec();

    return view;
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  }


  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);

  if (QUERY_TIME_MODE) console.timeEnd('executeLatestAddressMappingsQuery');
  return collectedRes;
}


export async function executeClaimAlertsQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('executeClaimAlertsQuery');

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ClaimAlertModel, currBookmark, 'createdTimestamp', '_id');

    const view = await ClaimAlertModel.find({
      cosmosAddresses: {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      ...paginationParams,
    }).sort({ createdTimestamp: -1, _id: -1 }).limit(25).lean().exec();

    return view.map((row) => {
      return {
        ...row,
        cosmosAddresses: row?.cosmosAddresses.includes(cosmosAddress) ? [cosmosAddress] : row?.cosmosAddresses //For the user queries, we don't need to return all the to addresses
      }
    })
  }

  const filterFunc = async (viewDocs: any[]) => { return viewDocs; }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeClaimAlertsQuery');
  return collectedRes;
}

export const filterCollectionsFunc = async (viewDocs: any[], hiddenBadges: { collectionId: bigint, badgeIds: UintRange<bigint>[] }[]) => {
  return viewDocs.filter((doc) => {
    if (hiddenBadges?.find((hiddenBadge) => hiddenBadge.collectionId === BigInt(doc))) {
      return false;
    }

    if (complianceDoc?.badges?.reported?.find((reported) => reported.collectionId === BigInt(doc))) {
      return false;
    }

    return true;
  });
}

export async function executeManagingQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>,
  filteredCollections?: {
    badgeIds: UintRange<NumberType>[];
    collectionId: NumberType;
  }[],
  bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeManagingQuery');

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(CollectionModel, currBookmark, '_id');

    const view = await CollectionModel.find({
      collectionId: filteredCollections ? { "$in": filteredCollections.map((collection) => Number(collection.collectionId)) } : { "$exists": true },
      managerTimeline: {
        "$elemMatch": {
          manager: {
            "$eq": cosmosAddress,
          },
        },
      },
      ...paginationParams,
    }).limit(25).sort({ _id: -1 }).lean().exec();

    return view.map((row) => row._legacyId);
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterCollectionsFunc(viewDocs, profileInfo.hiddenBadges ?? []);
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeManagingQuery');
  return collectedRes;
}

export async function executeCreatedByQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>,
  filteredCollections?: {
    badgeIds: UintRange<NumberType>[];
    collectionId: NumberType;
  }[],
  bookmark?: string,) {
  if (QUERY_TIME_MODE) console.time('executeCreatedByQuery');

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(CollectionModel, currBookmark, '_id');

    const view = await CollectionModel.find({
      collectionId: filteredCollections ? { "$in": filteredCollections.map((collection) => Number(collection.collectionId)) } : { "$exists": true },
      createdBy: cosmosAddress,
      ...paginationParams,
    }).limit(25).sort({ _id: -1 }).lean().exec();

    return view.map((row) => row._legacyId);
  }

  const filterFunc = async (viewDocs: any[]) => {
    return await filterCollectionsFunc(viewDocs, profileInfo.hiddenBadges ?? []);
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('executeCreatedByQuery');
  return collectedRes;
}


export async function executeAuthCodesQuery(cosmosAddress: string, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('authCodes');
  const paginationParams = await getQueryParamsFromBookmark(BlockinAuthSignatureModel, bookmark, '_id');

  const res = await BlockinAuthSignatureModel.find({
    cosmosAddress: cosmosAddress,
    ...paginationParams,
  }).sort({ _id: -1 }).limit(25).lean().exec();


  if (QUERY_TIME_MODE) console.timeEnd('authCodes');
  return {
    docs: res,
    bookmark: (res.length > 0 ? res[res.length - 1]._id.toString() : undefined),
  }
}


export async function executePrivateListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('privateLists');
  const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, bookmark, '_id');

  const res = await AddressMappingModel.find({
    mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
    createdBy: cosmosAddress,
    private: true,
    ...paginationParams,
  }).sort({ _id: -1 }).limit(25).lean().exec();

  //Could filter hidden here but they created it so they should be able to see it


  if (QUERY_TIME_MODE) console.timeEnd('privateLists');
  return {
    docs: res,
    bookmark: (res.length > 0 ? res[res.length - 1]._id.toString() : undefined),
  }
}

export async function executeCreatedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('createdLists');
  const paginationParams = await getQueryParamsFromBookmark(AddressMappingModel, bookmark, '_id');

  const res = await AddressMappingModel.find({
    mappingId: filteredLists ? { "$in": filteredLists } : { "$exists": true },
    createdBy: cosmosAddress,
    private: false,
    ...paginationParams,
  }).lean().exec();
  //Could filter hidden here but they created it so they should be able to see it

  if (QUERY_TIME_MODE) console.timeEnd('createdLists');
  return {
    docs: res,
    bookmark: (res.length > 0 ? res[res.length - 1]._id.toString() : undefined),
  }
}

export async function executeListsActivityQuery(cosmosAddress: string, profileInfo: ProfileInfoBase<bigint>, fetchHidden: boolean, bookmark?: string) {
  if (QUERY_TIME_MODE) console.time('listsActivityQuery');

  const hiddenLists = [...profileInfo.hiddenLists ?? [], ...complianceDoc?.addressMappings.reported.map(x => x.mappingId) ?? []];


  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ListActivityModel, currBookmark, 'timestamp', '_id');

    const view = await ListActivityModel.find({
      "addresses": {
        "$elemMatch": {
          "$eq": cosmosAddress,
        },
      },
      ...paginationParams,
    }).sort({ timestamp: -1, _id: -1 }).limit(25).lean().exec();

    let viewDocs = view.map((doc) => {
      return {
        ...doc,
        to: doc?.addresses?.includes(cosmosAddress) ? [cosmosAddress] : doc?.addresses //For the user queries, we don't need to return all the to addresses
      }
    })

    return viewDocs;
  }

  const filterFunc = async (viewDocs: any[]) => {
    if (!fetchHidden) {
      const nonHiddenDocs = viewDocs.map((doc) => {
        if (!doc || !hiddenLists) return undefined;
        let matchingHiddenList = hiddenLists.find(x => x === doc.mappingId) ?? doc.mappingId;

        return {
          ...doc,
          mappingId: matchingHiddenList
        }
      }).filter((doc) => doc !== undefined);

      viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find(x => x && x._legacyId === doc._legacyId));
    }

    return viewDocs;
  }

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  if (QUERY_TIME_MODE) console.timeEnd('listsActivityQuery');
  return collectedRes;
}
