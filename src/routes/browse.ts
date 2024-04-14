import {
  type ErrorResponse,
  type NumberType,
  type UintRange,
  UintRangeArray,
  convertToCosmosAddress,
  type iGetBrowseCollectionsRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { DEV_MODE } from '../constants';
import { complianceDoc } from '../poll';
import { executeCollectionsQuery, type CollectionQueryOptions } from './collections';
import { getAccountByAddress } from './users';
import { getAddressListsFromDB } from './utils';
import { mustGetFromDB } from '../db/db';
import { BrowseModel, CollectionModel, TransferActivityModel, AddressListModel, ProfileModel } from '../db/schemas';
import { findInDB } from '../db/queries';

let cachedResult: iGetBrowseCollectionsRouteSuccessResponse<NumberType> | ErrorResponse | undefined;
let lastFetchTime = 0;

export const getBrowseCollections = async (req: Request, res: Response<iGetBrowseCollectionsRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    if (cachedResult && Date.now() - lastFetchTime < 1000 * 60 * 1 && !DEV_MODE) {
      return res.status(200).send(cachedResult);
    }
    const browseDoc = await mustGetFromDB(BrowseModel, 'browse');

    const collectionsToFetch = [];
    for (const [, value] of Object.entries(browseDoc.collections)) {
      collectionsToFetch.push(...value);
    }

    for (const [, value] of Object.entries(browseDoc.badges)) {
      for (const badge of value) {
        collectionsToFetch.push(badge.collectionId);
      }
    }

    const listsToFetch = [];
    for (const [, value] of Object.entries(browseDoc.addressLists)) {
      for (const listId of value) {
        listsToFetch.push(listId);
      }
    }

    const profilesToFetch = [];
    for (const [, value] of Object.entries(browseDoc.profiles)) {
      profilesToFetch.push(...value);
    }

    const [browseDocCollections, activity, addressLists, browseDocAddressLists, browseDocProfiles] = await Promise.all([
      findInDB(CollectionModel, { query: { collectionId: { $in: collectionsToFetch } } }),
      findInDB(TransferActivityModel, { query: {}, sort: { timestamp: -1 }, limit: 100 }),
      findInDB(AddressListModel, {
        query: { private: { $ne: true } },
        sort: { createdBlock: -1 },
        limit: 100
      }),
      findInDB(AddressListModel, { query: { listId: { $in: listsToFetch } } }),
      findInDB(ProfileModel, { query: { _docId: { $in: profilesToFetch } } })
    ]);

    const allProfiles = profilesToFetch.map((x) => {
      const profile = browseDocProfiles.find((y) => y._docId === x);
      if (profile) {
        return profile;
      } else {
        return {
          _docId: convertToCosmosAddress(x)
        };
      }
    });

    const toFetch = [
      // we also need to fetch metadata for the browse collections
      ...Object.entries(browseDoc.badges)
        .map(([, value]) => {
          return value.map((x) => {
            return {
              collectionId: x.collectionId,
              fetchTotalAndMintBalances: true,
              handleAllAndAppendDefaults: true,
              metadataToFetch: {
                badgeIds: x.badgeIds
              }
            };
          });
        })
        .flat(),

      ...[...browseDocCollections].map((doc) => {
        return {
          collectionId: doc._docId,
          fetchTotalAndMintBalances: true,
          handleAllAndAppendDefaults: true,
          metadataToFetch: {
            badgeIds: [{ start: 1n, end: 15n }]
          }
        };
      })
    ];

    const condensedToFetch: CollectionQueryOptions[] = [];
    for (const fetch of toFetch) {
      const matchingReq = condensedToFetch.find((x) => BigInt(x.collectionId) === BigInt(fetch.collectionId));
      if (matchingReq) {
        matchingReq.metadataToFetch = matchingReq.metadataToFetch ?? {
          badgeIds: new UintRangeArray()
        };
        const badgeIdsArr = UintRangeArray.From(matchingReq.metadataToFetch.badgeIds as Array<UintRange<bigint>>);
        badgeIdsArr.push(...(fetch.metadataToFetch.badgeIds as Array<UintRange<bigint>>));
        badgeIdsArr.sortAndMerge();
        matchingReq.metadataToFetch.badgeIds = badgeIdsArr;
      } else {
        condensedToFetch.push(fetch);
      }
    }
    const collections = await executeCollectionsQuery(req, condensedToFetch);

    const addressListsToReturn = await getAddressListsFromDB(
      addressLists.map((x) => {
        return {
          listId: x._docId
        };
      }),
      true
    );

    const promises = [];
    for (const profile of [...allProfiles]) {
      promises.push(
        getAccountByAddress(req, profile._docId, {
          viewsToFetch: []
        })
      );
    }

    const allAccounts = await Promise.all(promises);

    const result: iGetBrowseCollectionsRouteSuccessResponse<NumberType> = {
      collections: {
        // intitialize all keys w/ empty array to maintain order
        ...Object.fromEntries(
          Object.entries(browseDoc.collections).map(([key]) => {
            return [key, []];
          })
        )

        // 'featured': collections,
        // 'latest': latestCollections.map(x => collections.find(y => y.collectionId.toString() === x._docId.toString())).filter(x => x) as BitBadgesCollection<NumberType>[],
      },
      activity,
      addressLists: {
        ...Object.fromEntries(
          Object.entries(browseDoc.addressLists).map(([key]) => {
            return [key, []];
          })
        ),

        latest: addressListsToReturn
      },
      profiles: {
        ...Object.fromEntries(
          Object.entries(browseDoc.profiles).map(([key]) => {
            return [key, []];
          })
        )
      },
      badges: {
        ...Object.fromEntries(
          Object.entries(browseDoc.badges).map(([key]) => {
            return [key, []];
          })
        )
      }
    };

    for (const [key, value] of Object.entries(browseDoc.badges)) {
      for (const badge of value) {
        const collection = collections.find((x) => x.collectionId.toString() === badge.collectionId.toString());
        if (!collection) {
          continue;
        }

        result.badges[`${key}` as keyof typeof result.badges] = result.badges[`${key}` as keyof typeof result.badges] || [];
        result.badges[`${key}` as keyof typeof result.badges].push({
          collection,
          badgeIds: badge.badgeIds
        });
      }
    }

    for (const [key, value] of Object.entries(browseDoc.addressLists)) {
      for (const listId of value) {
        const addressList = browseDocAddressLists.find((x) => x.listId.toString() === listId.toString());
        if (!addressList) {
          continue;
        }
        result.addressLists[`${key}` as keyof typeof result.addressLists] = result.addressLists[`${key}` as keyof typeof result.addressLists] || [];
        result.addressLists[`${key}` as keyof typeof result.addressLists].push({
          ...addressList,
          listsActivity: [],
          claims: [],
          views: {}
        });
      }
    }

    for (const [key, value] of Object.entries(browseDoc.profiles)) {
      for (const address of value) {
        const account = allAccounts.find((x) => x.cosmosAddress.toString() === convertToCosmosAddress(address).toString());
        if (!account) {
          continue;
        }
        result.profiles[`${key}` as keyof typeof result.profiles] = result.profiles[`${key}` as keyof typeof result.profiles] || [];
        result.profiles[`${key}` as keyof typeof result.profiles].push(account);
      }
    }

    for (const [key, value] of Object.entries(browseDoc.collections)) {
      for (const activity of value) {
        const collection = collections.find((x) => x.collectionId.toString() === activity.toString());
        if (!collection) {
          continue;
        }
        result.collections[`${key}` as keyof typeof result.collections] = result.collections[`${key}` as keyof typeof result.collections] || [];
        result.collections[`${key}` as keyof typeof result.collections].push(collection);
      }
    }

    // Make sure no reported stuff gets populated
    for (const [key, value] of Object.entries(result.collections)) {
      result.collections[`${key}` as keyof typeof result.collections] = value.filter(
        (x) => complianceDoc?.badges.reported?.some((y) => y.collectionId === BigInt(x.collectionId)) !== true
      );
    }

    for (const [key, value] of Object.entries(result.addressLists)) {
      result.addressLists[`${key}` as keyof typeof result.addressLists] = value.filter(
        (x) => complianceDoc?.addressLists.reported?.some((y) => y.listId === x.listId) !== true
      );
    }

    for (const [key, value] of Object.entries(result.profiles)) {
      result.profiles[`${key}` as keyof typeof result.profiles] = value.filter(
        (x) => complianceDoc?.accounts.reported?.some((y) => y.cosmosAddress === convertToCosmosAddress(x.address)) !== true
      );
    }

    for (const [key, value] of Object.entries(result.badges)) {
      result.badges[`${key}` as keyof typeof result.badges] = value.filter(
        (x) => complianceDoc?.badges.reported?.some((y) => y.collectionId === BigInt(x.collection.collectionId)) !== true
      );
    }

    result.activity = result.activity.filter((x) => complianceDoc?.badges.reported?.some((y) => y.collectionId === BigInt(x.collectionId)) !== true);

    cachedResult = result;
    lastFetchTime = Date.now();

    return res.status(200).send(result);
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting collections'
    });
  }
};
