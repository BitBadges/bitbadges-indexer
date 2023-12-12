import { BitBadgesCollection, GetBrowseCollectionsRouteResponse, NumberType, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AddressMappingModel, CollectionModel, FetchModel, ProfileModel, TransferActivityModel } from "../db/db";
import { executeCollectionsQuery } from "./collections";
import { getAccountByAddress } from "./users";
import { getAddressMappingsFromDB } from "./utils";
import { complianceDoc } from "../poll";

let cachedResult: GetBrowseCollectionsRouteResponse<NumberType> | undefined = undefined;
let lastFetchTime = 0;


export const getBrowseCollections = async (req: Request, res: Response<GetBrowseCollectionsRouteResponse<NumberType>>) => {
  try {
    if (cachedResult && Date.now() - lastFetchTime < 1000 * 60 * 5) { //5 minutes
      return res.status(200).send(cachedResult);
    }


    //TODO: populate with better data

    const [
      certificationsCollections,
      latestCollections,
      attendanceCollections,
      activity,
      profiles,
      addressMappings
    ] = await Promise.all([
      FetchModel.find({
        "content.category": "Certification",
        "db": "Metadata"
      }).lean().exec(),
      CollectionModel.find({}).sort({ "createdBlock": -1 }).limit(24).lean().exec(),

      FetchModel.find({
        "content.category": "Attendance",
        "db": "Metadata"
      }).lean().exec(),
      TransferActivityModel.find({}).sort({ "timestamp": -1 }).limit(100).lean().exec(),
      ProfileModel.find({}).limit(25).lean().exec(),
      AddressMappingModel.find({

        private: { "$ne": true }
      }).sort({ "createdBlock": -1 }).limit(100).lean().exec(),
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


    const collections = await executeCollectionsQuery(req, [
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
    }));

    //latest activity


    let addressMappingsToReturn = await getAddressMappingsFromDB(addressMappings.map(x => {
      return {
        mappingId: x._legacyId,
      }
    }), true);



    const promises = [];
    for (const profile of profiles) {
      promises.push(getAccountByAddress(req, profile._legacyId, {
        viewsToFetch: [{

          viewKey: 'badgesCollected',
          bookmark: '',
        }],
      }));
    }

    const allAccounts = await Promise.all(promises);





    let result = {
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
    }

    //Make sure no reported stuff gets populated
    result.collections = {
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

    cachedResult = result;
    lastFetchTime = Date.now();


    return res.status(200).send(result);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error getting collections'
    });
  }
}