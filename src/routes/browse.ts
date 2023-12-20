import { BitBadgesCollection, GetBrowseCollectionsRouteResponse, NumberType, convertBitBadgesCollection, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { DEV_MODE } from "../constants";
import { AddressMappingModel, BrowseModel, CollectionModel, FetchModel, ProfileModel, TransferActivityModel, mustGetFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { executeCollectionsQuery } from "./collections";
import { getAccountByAddress } from "./users";
import { getAddressMappingsFromDB } from "./utils";
import { BigIntify } from "bitbadgesjs-proto";

let cachedResult: GetBrowseCollectionsRouteResponse<NumberType> | undefined = undefined;
let lastFetchTime = 0;


export const getBrowseCollections = async (req: Request, res: Response<GetBrowseCollectionsRouteResponse<NumberType>>) => {
  try {
    if (cachedResult && Date.now() - lastFetchTime < 1000 * 60 * 5 && !DEV_MODE) {
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

    const mappingsToFetch = [];
    for (const [_, value] of Object.entries(browseDoc.addressMappings)) {
      mappingsToFetch.push(...value);
    }

    const profilesToFetch = [];
    for (const [_, value] of Object.entries(browseDoc.profiles)) {
      profilesToFetch.push(...value);
    }



    const [
      browseDocCollections,
      certificationsCollections,
      latestCollections,
      attendanceCollections,
      activity,
      profiles,
      addressMappings,
      browseDocAddressMappings,
      browseDocProfiles,
    ] = await Promise.all([
      CollectionModel.find({ "collectionId": { "$in": browseDoc.collections.featured } }).lean().exec(),
      FetchModel.find({ "content.category": "Certification", "db": "Metadata" }).lean().exec(),
      CollectionModel.find({}).sort({ "createdBlock": -1 }).limit(24).lean().exec(),
      FetchModel.find({ "content.category": "Attendance", "db": "Metadata" }).limit(24).lean().exec(),
      TransferActivityModel.find({}).sort({ "timestamp": -1 }).limit(100).lean().exec(),
      ProfileModel.find({ username: { "$exists": true } }).limit(25).lean().exec(),
      AddressMappingModel.find({ private: { "$ne": true } }).sort({ "createdBlock": -1 }).limit(100).lean().exec(),
      AddressMappingModel.find({ "mappingId": { "$in": mappingsToFetch } }).lean().exec(),
      ProfileModel.find({ "address": { "$in": profilesToFetch } }).lean().exec(),
    ]);



    const uris = [...new Set([...attendanceCollections.map(x => x._legacyId), ...certificationsCollections.map(x => x._legacyId)])];
    const urisForCollectionQuery = await CollectionModel.find({
      collectionMetadataTimeline: {
        $elemMatch: {
          collectionMetadata: {
            uri: {
              $in: uris,
            },
          },
        },
      },
    }).limit(100).lean().exec();


    const collections = await executeCollectionsQuery(req,
      [
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
          ...latestCollections,
          ...urisForCollectionQuery,
        ].map(doc => {
          return {
            collectionId: doc._legacyId,
            fetchTotalAndMintBalances: true,
            handleAllAndAppendDefaults: true,
            metadataToFetch: {
              badgeIds: [{ start: 1n, end: 15n }],
            },
          }
        })

      ]
    );

    //latest activity


    let addressMappingsToReturn = await getAddressMappingsFromDB(addressMappings.map(x => {
      return {
        mappingId: x._legacyId,
      }
    }), true);



    const promises = [];
    for (const profile of [...profiles, ...browseDocProfiles]) {
      promises.push(getAccountByAddress(req, profile._legacyId, {
        viewsToFetch: [{
          viewKey: 'badgesCollected',
          bookmark: '',
        }],
      }));
    }

    const allAccounts = await Promise.all(promises);

    let result: GetBrowseCollectionsRouteResponse<NumberType> = {
      collections: {
        // 'featured': collections,
        'latest': latestCollections.map(x => collections.find(y => y.collectionId.toString() === x._legacyId.toString())).filter(x => x) as BitBadgesCollection<NumberType>[],
        'attendance': attendanceCollections.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
          attendanceCollections.map(x => x._legacyId).includes(x.collectionMetadata.uri)
        ))).filter(x => x) as BitBadgesCollection<NumberType>[],
        'certifications': certificationsCollections.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
          certificationsCollections.map(x => x._legacyId).includes(x.collectionMetadata.uri)
        ))).filter(x => x) as BitBadgesCollection<NumberType>[],
      },
      activity: activity,
      addressMappings: {
        'latest': addressMappingsToReturn,
      },
      profiles: {
        'featured': [
          ...allAccounts,
        ]
      },
      badges: {

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

    for (const [key, value] of Object.entries(browseDoc.addressMappings)) {
      for (const mappingId of value) {
        const addressMapping = browseDocAddressMappings.find(x => x.mappingId.toString() === mappingId.toString());
        if (!addressMapping) {
          continue;
        }
        result.addressMappings[`${key}` as keyof typeof result.addressMappings] = result.addressMappings[`${key}` as keyof typeof result.addressMappings] || [];
        result.addressMappings[`${key}` as keyof typeof result.addressMappings].push(addressMapping);
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
    result.collections = {
      featured: result.collections.featured.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true),
      latest: result.collections.latest.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true),
      attendance: result.collections.attendance.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true),
      certifications: result.collections.certifications.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true),
    }
    result.activity = result.activity.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true);
    result.addressMappings = {
      latest: result.addressMappings.latest.filter(x => complianceDoc?.addressMappings.reported?.some(y => y.mappingId === x.mappingId) !== true),
    }
    result.profiles = {
      featured: result.profiles.featured.filter(x => complianceDoc?.accounts.reported?.some(y => y.cosmosAddress === convertToCosmosAddress(x.address)) !== true),
    }
    result.badges = {
      featured: result.badges.featured.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collection.collectionId)) !== true),
    }

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