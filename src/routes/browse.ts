import { BigIntify, UintRange, convertUintRange } from "bitbadgesjs-proto";
import { GetBrowseCollectionsRouteResponse, NumberType, convertBitBadgesCollection, convertToCosmosAddress, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AddressListModel, BrowseModel, CollectionModel, ProfileModel, TransferActivityModel, mustGetFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { CollectionQueryOptions, executeCollectionsQuery } from "./collections";
import { getAccountByAddress } from "./users";
import { getAddressListsFromDB } from "./utils";
import { DEV_MODE } from "../constants";

let cachedResult: GetBrowseCollectionsRouteResponse<NumberType> | undefined = undefined;
let lastFetchTime = 0;


export const getBrowseCollections = async (req: Request, res: Response<GetBrowseCollectionsRouteResponse<NumberType>>) => {
  try {
    if (cachedResult && Date.now() - lastFetchTime < 1000 * 60 * 1 && !DEV_MODE) {
      return res.status(200).send(cachedResult);
    }
    const browseDoc = await mustGetFromDB(BrowseModel, 'browse');

    const collectionsToFetch = [];
    for (const [_, value] of Object.entries(browseDoc.collections)) {
      collectionsToFetch.push(...value);
    }

    for (const [_, value] of Object.entries(browseDoc.badges)) {
      for (const badge of value) {
        collectionsToFetch.push(badge.collectionId);
      }
    }

    const listsToFetch = [];
    for (const [_, value] of Object.entries(browseDoc.addressLists)) {
      for (const listId of value) {
        listsToFetch.push(listId);
      }
    }

    const profilesToFetch = [];
    for (const [_, value] of Object.entries(browseDoc.profiles)) {
      profilesToFetch.push(...value);
    }



    const [
      browseDocCollections,
      activity,
      addressLists,
      browseDocAddressLists,
      browseDocProfiles,
    ] = await Promise.all([
      CollectionModel.find({ "collectionId": { "$in": browseDoc.collections.featured } }).lean().exec(),
      TransferActivityModel.find({}).sort({ "timestamp": -1 }).limit(100).lean().exec(),
      AddressListModel.find({ private: { "$ne": true } }).sort({ "createdBlock": -1 }).limit(100).lean().exec(),
      AddressListModel.find({ "listId": { "$in": listsToFetch } }).lean().exec(),
      ProfileModel.find({ "_docId": { "$in": profilesToFetch } }).lean().exec(),
    ]);

    const allProfiles = profilesToFetch.map(x => {
      const profile = browseDocProfiles.find(y => y._docId === x);
      if (profile) {
        return profile;
      } else {
        return {
          _docId: convertToCosmosAddress(x),
        }
      }
    })

    const toFetch = [
      //we also need to fetch metadata for the browse collections
      ...Object.entries(browseDoc.badges).map(([_, value]) => {
        return value.map(x => {
          return {
            collectionId: x.collectionId,
            fetchTotalAndMintBalances: true,
            handleAllAndAppendDefaults: true,
            metadataToFetch: {
              badgeIds: x.badgeIds,
            },
          }
        })
      }).flat(),

      ...[
        ...browseDocCollections,
      ].map(doc => {
        return {
          collectionId: doc._docId,
          fetchTotalAndMintBalances: true,
          handleAllAndAppendDefaults: true,
          metadataToFetch: {
            badgeIds: [{ start: 1n, end: 15n }],
          },
        }
      })
    ]

    const condensedToFetch: CollectionQueryOptions[] = [];
    for (const fetch of toFetch) {
      const matchingReq = condensedToFetch.find(x => BigInt(x.collectionId) === BigInt(fetch.collectionId));
      if (matchingReq) {
        matchingReq.metadataToFetch = matchingReq.metadataToFetch || {
          badgeIds: [],
        };
        matchingReq.metadataToFetch.badgeIds = sortUintRangesAndMergeIfNecessary([...matchingReq.metadataToFetch.badgeIds as UintRange<bigint>[], ...fetch.metadataToFetch.badgeIds as UintRange<bigint>[]]
          .map(x => convertUintRange(x, BigIntify))
          , true);
      } else {
        condensedToFetch.push(fetch);
      }

    }
    const collections = await executeCollectionsQuery(req,
      condensedToFetch
    );


    let addressListsToReturn = await getAddressListsFromDB(addressLists.map(x => {
      return {
        listId: x._docId,
      }
    }), true);

    const promises = [];
    for (const profile of [...allProfiles]) {
      promises.push(getAccountByAddress(req, profile._docId, {
        viewsToFetch: [],
      }));
    }

    const allAccounts = await Promise.all(promises);

    let result: GetBrowseCollectionsRouteResponse<NumberType> = {
      collections: {
        //intitialize all keys w/ empty array to maintain order
        ...Object.fromEntries(Object.entries(browseDoc.collections).map(([key, value]) => {
          return [key, []];
        })),

        // 'featured': collections,
        // 'latest': latestCollections.map(x => collections.find(y => y.collectionId.toString() === x._docId.toString())).filter(x => x) as BitBadgesCollection<NumberType>[],
      },
      activity: activity,
      addressLists: {
        ...Object.fromEntries(Object.entries(browseDoc.addressLists).map(([key, value]) => {
          return [key, []];
        })),

        'latest': addressListsToReturn,
      },
      profiles: {
        ...Object.fromEntries(Object.entries(browseDoc.profiles).map(([key, value]) => {
          return [key, []];
        })),
      },
      badges: {
        ...Object.fromEntries(Object.entries(browseDoc.badges).map(([key, value]) => {
          return [key, []];
        })),
      }
    }

    for (const [key, value] of Object.entries(browseDoc.badges)) {
      for (const badge of value) {
        const collection = collections.find(x => x.collectionId.toString() === badge.collectionId.toString());
        if (!collection) {
          continue;
        }


        result.badges[`${key}` as keyof typeof result.badges] = result.badges[`${key}` as keyof typeof result.badges] || [];
        result.badges[`${key}` as keyof typeof result.badges].push({
          collection: convertBitBadgesCollection(collection, BigIntify),
          badgeIds: badge.badgeIds,
        })
      }
    }

    for (const [key, value] of Object.entries(browseDoc.addressLists)) {
      for (const listId of value) {
        const addressList = browseDocAddressLists.find(x => x.listId.toString() === listId.toString());
        if (!addressList) {
          continue;
        }
        result.addressLists[`${key}` as keyof typeof result.addressLists] = result.addressLists[`${key}` as keyof typeof result.addressLists] || [];
        result.addressLists[`${key}` as keyof typeof result.addressLists].push({
          ...addressList,
          listsActivity: [],
          views: {}
        });
      }
    }

    for (const [key, value] of Object.entries(browseDoc.profiles)) {
      for (const address of value) {
        const account = allAccounts.find(x => x.cosmosAddress.toString() === convertToCosmosAddress(address).toString());
        if (!account) {
          continue;
        }
        result.profiles[`${key}` as keyof typeof result.profiles] = result.profiles[`${key}` as keyof typeof result.profiles] || [];
        result.profiles[`${key}` as keyof typeof result.profiles].push(account);
      }
    }

    for (const [key, value] of Object.entries(browseDoc.collections)) {
      for (const activity of value) {
        const collection = collections.find(x => x.collectionId.toString() === activity.toString());
        if (!collection) {
          continue;
        }
        result.collections[`${key}` as keyof typeof result.collections] = result.collections[`${key}` as keyof typeof result.collections] || [];
        result.collections[`${key}` as keyof typeof result.collections].push(convertBitBadgesCollection(collection, BigIntify));
      }
    }

    //Make sure no reported stuff gets populated
    for (const [key, value] of Object.entries(result.collections)) {
      result.collections[`${key}` as keyof typeof result.collections] = value.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true);
    }

    for (const [key, value] of Object.entries(result.addressLists)) {
      result.addressLists[`${key}` as keyof typeof result.addressLists] = value.filter(x => complianceDoc?.addressLists.reported?.some(y => y.listId === x.listId) !== true);
    }

    for (const [key, value] of Object.entries(result.profiles)) {
      result.profiles[`${key}` as keyof typeof result.profiles] = value.filter(x => complianceDoc?.accounts.reported?.some(y => y.cosmosAddress === convertToCosmosAddress(x.address)) !== true);
    }

    for (const [key, value] of Object.entries(result.badges)) {
      result.badges[`${key}` as keyof typeof result.badges] = value.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collection.collectionId)) !== true);
    }

    result.activity = result.activity.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true);

    cachedResult = result;
    lastFetchTime = Date.now();


    return res.status(200).send(result);
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error getting collections'
    });
  }
}