import { BitBadgesCollection, GetBrowseCollectionsRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { ADDRESS_MAPPINGS_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB, TRANSFER_ACTIVITY_DB } from "../db/db";
import { removeCouchDBDetails } from "../utils/couchdb-utils";
import { executeCollectionsQuery } from "./collections";
import { getAccountByAddress } from "./users";
import { getAddressMappingsFromDB } from "./utils";

export const getBrowseCollections = async (req: Request, res: Response<GetBrowseCollectionsRouteResponse<NumberType>>) => {
  try {
    //TODO: populate with better data

    const latestQuery: nano.MangoQuery = {
      selector: {
        "_id": { "$gt": null },
        "createdBlock": { "$gt": null }
      },
      sort: [{ "createdBlock": "desc" }],
      limit: 24,
      update: true,
    }

    const attendanceQuery: nano.MangoQuery = {
      selector: {
        "_id": { "$gt": null },
        "content": {
          "category": {
            "$eq": "Attendance",
          },
        },
        "db": {
          "$eq": "Metadata",
        }
      }
    }



    const certificationsQuery = {
      selector: {
        "_id": { "$gt": null },
        "content": {

          "category": {
            "$eq": "Certification",
          },
        },
        "db": {
          "$eq": "Metadata",
        }
      }
    }

    const transferActivityQuery: nano.MangoQuery = {
      selector: {
        timestamp: {
          "$gt": null,
        }
      },
      sort: [{ "timestamp": "desc" }],
      limit: 100,
    }

    const profilePicUrlQuery: nano.MangoQuery = {
      selector: {
        "_id": {
          "$gt": null,
        },
      },
      limit: 25
    }

    const addressMappingsQuery: nano.MangoQuery = {
      selector: {
        createdBlock: {
          "$gt": null,
        }
      },
      sort: [{ "createdBlock": "desc" }],
      fields: ['_id', '_rev'],
      limit: 100
    };

    const [
      certificationsCollections,
      latestCollections,
      attendanceCollections,
      activity,
      profiles,
      addressMappings
    ] = await Promise.all([
      FETCHES_DB.find(certificationsQuery),
      COLLECTIONS_DB.find(latestQuery),
      FETCHES_DB.find(attendanceQuery),
      TRANSFER_ACTIVITY_DB.find(transferActivityQuery),
      PROFILES_DB.find(profilePicUrlQuery),
      ADDRESS_MAPPINGS_DB.find(addressMappingsQuery)
    ]);

    const uris = [...new Set([...attendanceCollections.docs.map(x => x._id), ...certificationsCollections.docs.map(x => x._id)])];
    const urisQuery: nano.MangoQuery = {
      selector: {
        "_id": { "$gt": null },
        "collectionMetadataTimeline": {
          "$elemMatch": {
            "collectionMetadata": {
              "uri": {
                "$in": uris
              }
            }
          }
        }
      },
      limit: 100
    }

    const urisForCollectionQuery = await COLLECTIONS_DB.find(urisQuery);


    const collections = await executeCollectionsQuery(req, [
      ...latestCollections.docs,
      ...urisForCollectionQuery.docs,
    ].map(doc => {
      return {
        collectionId: doc._id,
        fetchTotalAndMintBalances: true,
        handleAllAndAppendDefaults: true,
        metadataToFetch: {
          badgeIds: [{ start: 1n, end: 15n }],
        },
      }
    }));

    //latest activity


    let addressMappingsToReturn = await getAddressMappingsFromDB(addressMappings.docs.map(x => {
      return {
        mappingId: x._id,
      }
    }), true);



    const promises = [];
    for (const profile of profiles.docs) {
      promises.push(getAccountByAddress(req, profile._id, {
        viewsToFetch: [{

          viewKey: 'badgesCollected',
          bookmark: '',
        }],
      }));
    }

    const allAccounts = await Promise.all(promises);

    return res.status(200).send({
      collections: {
        // 'featured': collections,
        'latest': latestCollections.docs.map(x => collections.find(y => y.collectionId.toString() === x._id.toString())).filter(x => x) as BitBadgesCollection<NumberType>[],
        'attendance': attendanceCollections.docs.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
          attendanceCollections.docs.map(x => x._id).includes(x.collectionMetadata.uri)
        ))).filter(x => x) as BitBadgesCollection<NumberType>[],
        'certifications': certificationsCollections.docs.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
          certificationsCollections.docs.map(x => x._id).includes(x.collectionMetadata.uri)
        ))).filter(x => x) as BitBadgesCollection<NumberType>[],
      },
      activity: activity.docs.map(x => removeCouchDBDetails(x)),
      addressMappings: {
        'latest': addressMappingsToReturn,
      },
      profiles: {
        'featured': [
          ...allAccounts,
          ...allAccounts,
          ...allAccounts,
          ...allAccounts,
        ].map(x => removeCouchDBDetails(x)),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error getting collections'
    });
  }
}