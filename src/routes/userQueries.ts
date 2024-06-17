import {
  ClaimAlertDoc,
  UintRangeArray,
  type BalanceDoc,
  type NumberType,
  type TransferActivityDoc,
  type iBatchBadgeDetails,
  type iProfileDoc,
  type iUintRange
} from 'bitbadgesjs-sdk';
import { getFromDB, getManyFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import {
  AddressListModel,
  BalanceModel,
  SIWBBRequestModel,
  ClaimAlertModel,
  CollectionModel,
  ListActivityModel,
  OffChainAttestationsModel,
  ReviewModel,
  TransferActivityModel,
  type BitBadgesDoc,
  ComplianceModel
} from '../db/schemas';
import { findWithPagination, getQueryParamsFromBookmark } from '../db/utils';

// Basically queries then filters until we get at least 25 results
// Max tries is 25
export async function queryAndFilter<T extends BitBadgesDoc<bigint>>(
  bookmark: string | undefined,
  queryFunc: (bookmark?: string) => Promise<T[]>,
  filterFunc: (docs: T[]) => Promise<T[]>
) {
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

    // If we have less than 25 docs, we break (note this is queries and all queries have page size of 25)
    if (queryDocs.length < 25) {
      break;
    }

    if (maxTries <= 0) {
      throw new Error('Max tries exceeded');
    }

    maxTries--;
  }

  return {
    docs,
    bookmark: currBookmark
  };
}

export const filterActivityFunc = async (viewDocs: Array<TransferActivityDoc<bigint>>, hiddenBadges: Array<iBatchBadgeDetails<bigint>>) => {
  const nonHiddenDocs = viewDocs
    .map((doc) => {
      if (!doc || !hiddenBadges || !doc.balances || !doc.collectionId) return undefined;
      const matchingHiddenBadge = hiddenBadges.find((x) => doc.collectionId && x.collectionId === BigInt(doc.collectionId)) ?? {
        collectionId: BigInt(doc.collectionId),
        badgeIds: []
      };

      for (const balance of doc.balances) {
        balance.badgeIds.remove(UintRangeArray.From(matchingHiddenBadge.badgeIds));
      }

      doc.balances = doc.balances.filterZeroBalances();
      return doc;
    })
    .filter((doc) => doc !== undefined);

  viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find((x) => x && x._docId === doc._docId));
  return viewDocs;
};

export async function executeMultiUserActivityQuery(cosmosAddresses: string[], bookmark?: string, oldestFirst?: boolean) {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(TransferActivityModel, {
      query: {
        $or: [
          {
            from: { $in: cosmosAddresses },
            ...paginationParams
          },
          {
            to: {
              $elemMatch: {
                $in: cosmosAddresses
              }
            },
            ...paginationParams
          }
        ]
      },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: Array<TransferActivityDoc<bigint>>) => {
    // TODO: Do we incorporate the user hidden badges here?
    const hiddenBadges = [...(complianceDoc?.badges.reported ?? [])];
    viewDocs = await filterActivityFunc(viewDocs, hiddenBadges);

    for (const doc of viewDocs) {
      doc.to = doc.to.filter((to) => cosmosAddresses.includes(to)); // For the user queries, we don't need to return all the to addresses
    }
    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeActivityQuery(
  cosmosAddress: string,
  profileInfo: iProfileDoc<bigint>,
  fetchHidden: boolean,
  bookmark?: string,
  oldestFirst?: boolean
) {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  const hiddenBadges = [...(profileInfo.hiddenBadges ?? []), ...(complianceDoc?.badges.reported ?? [])];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(TransferActivityModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(TransferActivityModel, {
      query: {
        $or: [
          {
            from: cosmosAddress,
            ...paginationParams
          },
          {
            to: {
              $elemMatch: {
                $eq: cosmosAddress
              }
            },
            ...paginationParams
          }
        ]
      },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: Array<TransferActivityDoc<bigint>>) => {
    if (!fetchHidden) {
      viewDocs = await filterActivityFunc(viewDocs, hiddenBadges);
    }

    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeReviewsQuery(cosmosAddress: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(ReviewModel, bookmark, oldestFirst, 'timestamp', '_id');
  const reviewsRes = await findWithPagination(ReviewModel, {
    query: {
      _docId: {
        $regex: `^user-${cosmosAddress}:`
      },
      ...paginationParams
    },
    sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
    limit: 25
  });
  return reviewsRes;
}

export const filterBalanceFunc = async (viewDocs: Array<BalanceDoc<bigint>>, hiddenBadges: Array<iBatchBadgeDetails<bigint>>) => {
  const nonHiddenDocs = viewDocs
    .map((doc) => {
      if (!doc || !hiddenBadges) return undefined;
      const matchingHiddenBadge = hiddenBadges.find((x) => x.collectionId === BigInt(doc.collectionId)) ?? {
        collectionId: BigInt(doc.collectionId),
        badgeIds: []
      };

      for (const balance of doc.balances) {
        balance.badgeIds.remove(UintRangeArray.From(matchingHiddenBadge.badgeIds));
      }

      doc.balances = doc.balances.filterZeroBalances();
      return doc;
    })
    .filter((doc) => doc !== undefined);

  viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find((x) => x && x._docId === doc._docId));

  return viewDocs;
};

export async function executeCollectedQuery(
  cosmosAddress: string,
  profileInfo: iProfileDoc<bigint>,
  fetchHidden: boolean,
  filteredCollections?: Array<iBatchBadgeDetails<NumberType>>,
  bookmark?: string,
  oldestFirst?: boolean
) {
  // keep searching until we have min 25 non-hidden docs
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  const hiddenBadges = [...(profileInfo.hiddenBadges ?? []), ...(complianceDoc?.badges.reported ?? [])];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(BalanceModel, currBookmark, oldestFirst, 'collectionId');
    return await findInDB(BalanceModel, {
      query: {
        collectionId: filteredCollections ? { $in: filteredCollections.map((collection) => Number(collection.collectionId)) } : { $exists: true },
        cosmosAddress,
        balances: {
          $elemMatch: {
            amount: {
              $gt: 0
            }
          }
        },
        ...paginationParams
      },
      sort: { collectionId: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: Array<BalanceDoc<bigint>>) => {
    if (!fetchHidden) {
      viewDocs = await filterBalanceFunc(viewDocs, hiddenBadges);
    }

    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export const filterListsFunc = async (viewDocs: any[]) => {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  return viewDocs.filter((doc) => complianceDoc?.addressLists?.reported?.find((reported) => reported.listId === doc.listId) === undefined);
};

export async function executeListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string, oldestFirst?: boolean) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressListModel, currBookmark, oldestFirst, 'createdBlock');
    return await findInDB(AddressListModel, {
      query: {
        listId: filteredLists ? { $in: filteredLists } : { $exists: true },
        addresses: {
          $elemMatch: {
            $eq: cosmosAddress
          }
        },
        private: {
          $ne: true
        },
        ...paginationParams
      },
      sort: { createdBlock: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeExplicitIncludedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string, oldestFirst?: boolean) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressListModel, currBookmark, oldestFirst, 'createdBlock');
    return await findInDB(AddressListModel, {
      query: {
        listId: filteredLists ? { $in: filteredLists } : { $exists: true },
        $or: [
          {
            $and: [
              {
                addresses: {
                  $elemMatch: {
                    $eq: cosmosAddress
                  }
                }
              },
              {
                whitelist: {
                  $eq: true
                }
              }
            ]
          }
        ],
        private: {
          $ne: true
        },
        ...paginationParams
      },
      sort: { createdBlock: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeExplicitExcludedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string, oldestFirst?: boolean) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(AddressListModel, currBookmark, oldestFirst, 'createdBlock');
    return await findInDB(AddressListModel, {
      query: {
        listId: filteredLists ? { $in: filteredLists } : { $exists: true },
        $or: [
          {
            $and: [
              {
                addresses: {
                  $elemMatch: {
                    $eq: cosmosAddress
                  }
                }
              },
              {
                whitelist: {
                  $eq: false
                }
              }
            ]
          }
        ],
        private: {
          $ne: true
        },
        ...paginationParams
      },
      sort: { createdBlock: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    return await filterListsFunc(viewDocs);
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeSentClaimAlertsQuery(cosmosAddress: string, bookmark?: string, oldestFirst?: boolean) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ClaimAlertModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(ClaimAlertModel, {
      query: {
        from: cosmosAddress,
        ...paginationParams
      },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: ClaimAlertDoc<bigint>[]) => {
    return viewDocs;
  };

  const res = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return res;
}

export async function executeClaimAlertsQuery(cosmosAddress: string, bookmark?: string, oldestFirst?: boolean) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ClaimAlertModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(ClaimAlertModel, {
      query: {
        cosmosAddresses: {
          $elemMatch: {
            $eq: cosmosAddress
          }
        },
        ...paginationParams
      },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    for (const doc of viewDocs) {
      doc.cosmosAddresses = doc?.cosmosAddresses.includes(cosmosAddress) ? [cosmosAddress] : doc?.cosmosAddresses; // For the user queries, we don't need to return all the to addresses
    }
    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export const filterCollectionsFunc = async (viewDocs: any[], hiddenBadges: Array<{ collectionId: bigint; badgeIds: Array<iUintRange<bigint>> }>) => {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  return viewDocs.filter((doc) => {
    if (hiddenBadges?.find((hiddenBadge) => hiddenBadge.collectionId === BigInt(doc.collectionId))) {
      return false;
    }

    if (complianceDoc?.badges?.reported?.find((reported) => reported.collectionId === BigInt(doc))) {
      return false;
    }

    return true;
  });
};

export async function executeManagingQuery(
  cosmosAddress: string,
  profileInfo: iProfileDoc<bigint>,
  filteredCollections?: Array<iBatchBadgeDetails<NumberType>>,
  bookmark?: string,
  oldestFirst?: boolean
) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(CollectionModel, currBookmark, oldestFirst, 'collectionId');
    return await findInDB(CollectionModel, {
      query: {
        collectionId: filteredCollections ? { $in: filteredCollections.map((collection) => Number(collection.collectionId)) } : { $exists: true },
        managerTimeline: {
          $elemMatch: {
            manager: {
              $eq: cosmosAddress
            }
          }
        },
        ...paginationParams
      },
      sort: { collectionId: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    const filtered = await filterCollectionsFunc(viewDocs, profileInfo.hiddenBadges ?? []);
    return filtered.map((row) => row._docId);
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);

  return collectedRes;
}

export async function executeCreatedByQuery(
  cosmosAddress: string,
  profileInfo: iProfileDoc<bigint>,
  filteredCollections?: Array<iBatchBadgeDetails<NumberType>>,
  bookmark?: string,
  oldestFirst?: boolean
) {
  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(CollectionModel, currBookmark, oldestFirst, 'collectionId');
    return await findInDB(CollectionModel, {
      query: {
        collectionId: filteredCollections ? { $in: filteredCollections.map((collection) => Number(collection.collectionId)) } : { $exists: true },
        createdBy: cosmosAddress,
        ...paginationParams
      },
      sort: { collectionId: oldestFirst ? 1 : -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    const filtered = await filterCollectionsFunc(viewDocs, profileInfo.hiddenBadges ?? []);
    return filtered.map((row) => row._docId);
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeSIWBBRequestsForAppQuery(clientId: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(SIWBBRequestModel, bookmark, oldestFirst, 'createdAt');
  const res = await findWithPagination(SIWBBRequestModel, {
    query: {
      clientId: { $eq: clientId },
      deletedAt: { $exists: false },
      redirectUri: { $exists: false },
      name: { $ne: '__temp' },
      ...paginationParams
    },
    sort: { createdAt: oldestFirst ? 1 : -1 },
    limit: 25
  });
  return res;
}

export async function executeSIWBBRequestsQuery(cosmosAddress: string, bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(SIWBBRequestModel, bookmark, oldestFirst, 'createdAt');
  const res = await findWithPagination(SIWBBRequestModel, {
    query: { cosmosAddress, deletedAt: { $exists: false }, redirectUri: { $exists: false }, name: { $ne: '__temp' }, ...paginationParams },
    sort: { createdAt: oldestFirst ? 1 : -1 },
    limit: 25
  });
  return res;
}

export async function executePrivateListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(AddressListModel, bookmark, oldestFirst, 'createdBlock');
  const res = await findWithPagination(AddressListModel, {
    query: {
      listId: filteredLists ? { $in: filteredLists } : { $exists: true },
      createdBy: cosmosAddress,
      private: true,
      ...paginationParams
    },
    sort: { createdBlock: oldestFirst ? 1 : -1 },
    limit: 25
  });
  return res;
}

export async function executeCreatedListsQuery(cosmosAddress: string, filteredLists?: string[], bookmark?: string, oldestFirst?: boolean) {
  const paginationParams = await getQueryParamsFromBookmark(AddressListModel, bookmark, oldestFirst, 'createdBlock');
  const res = await findWithPagination(AddressListModel, {
    query: {
      listId: filteredLists ? { $in: filteredLists } : { $exists: true },
      createdBy: cosmosAddress,
      private: {
        $ne: true // false or undefined
      },
      ...paginationParams
    },
    sort: { createdBlock: oldestFirst ? 1 : -1 },
    limit: 25
  });
  return res;
}

export async function executeListsActivityQuery(
  cosmosAddress: string,
  profileInfo: iProfileDoc<bigint>,
  fetchHidden: boolean,
  bookmark?: string,
  oldestFirst?: boolean,
  fetchPrivate?: boolean
) {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  const hiddenLists = [...(profileInfo.hiddenLists ?? []), ...(complianceDoc?.addressLists.reported.map((x) => x.listId) ?? [])];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ListActivityModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(ListActivityModel, {
      query: {
        addresses: {
          $elemMatch: {
            $eq: cosmosAddress
          }
        },
        ...paginationParams
      },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    if (!fetchHidden) {
      const nonHiddenDocs = viewDocs
        .map((doc) => {
          if (!doc || !hiddenLists) return undefined;
          const matchingHiddenList = hiddenLists.find((x) => x === doc.listId) ?? doc.listId;

          return {
            ...doc,
            listId: matchingHiddenList
          };
        })
        .filter((doc) => doc !== undefined);

      viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find((x) => x && x._docId === doc._docId));
    }

    if (!fetchPrivate) {
      const listIds = [...new Set(viewDocs.map((x) => x.listId))];
      const lists = await getManyFromDB(AddressListModel, listIds);

      viewDocs = viewDocs.filter((doc) => {
        const list = lists.find((x) => x && x.listId === doc.listId);
        return list && !list.private;
      });
    }

    for (const doc of viewDocs) {
      doc.to = doc?.addresses?.includes(cosmosAddress) ? [cosmosAddress] : doc?.addresses; // For the user queries, we don't need to return all the to addresses
    }

    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeListsActivityQueryForList(listId: string, fetchHidden: boolean, bookmark?: string, oldestFirst?: boolean) {
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  const hiddenLists = [...(complianceDoc?.addressLists.reported.map((x) => x.listId) ?? [])];

  const queryFunc = async (currBookmark?: string) => {
    const paginationParams = await getQueryParamsFromBookmark(ListActivityModel, currBookmark, oldestFirst, 'timestamp', '_id');
    return await findInDB(ListActivityModel, {
      query: { listId, ...paginationParams },
      sort: { timestamp: oldestFirst ? 1 : -1, _id: -1 },
      limit: 25
    });
  };

  const filterFunc = async (viewDocs: any[]) => {
    if (!fetchHidden) {
      const nonHiddenDocs = viewDocs
        .map((doc) => {
          if (!doc || !hiddenLists) return undefined;
          const matchingHiddenList = hiddenLists.find((x) => x === doc.listId) ?? doc.listId;

          return {
            ...doc,
            listId: matchingHiddenList
          };
        })
        .filter((doc) => doc !== undefined);

      viewDocs = viewDocs.filter((doc) => doc && nonHiddenDocs.find((x) => x && x._docId === doc._docId));
    }

    return viewDocs;
  };

  const collectedRes = await queryAndFilter(bookmark, queryFunc, filterFunc);
  return collectedRes;
}

export async function executeCreatedAttestationsQuery(cosmosAddress: string, bookmark?: string) {
  const paginationParams = await getQueryParamsFromBookmark(OffChainAttestationsModel, bookmark, false, 'attestationId');
  const res = await findWithPagination(OffChainAttestationsModel, {
    query: { createdBy: cosmosAddress, ...paginationParams },
    sort: { attestationId: 1 },
    limit: 25
  });
  return res;
}

export async function executeReceivedAttestationsQuery(cosmosAddress: string, bookmark?: string) {
  const paginationParams = await getQueryParamsFromBookmark(OffChainAttestationsModel, bookmark, false, 'attestationId');
  const res = await findWithPagination(OffChainAttestationsModel, {
    query: {
      holders: {
        $elemMatch: {
          $eq: cosmosAddress
        }
      },
      ...paginationParams
    },
    sort: { attestationId: 1 },
    limit: 25
  });
  return res;
}
