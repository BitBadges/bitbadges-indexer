import { Request, Response } from "express";
import nano from "nano";
import { COLLECTIONS_DB, FETCHES_DB } from "../db/db";
import { serializeError } from "serialize-error";
import { BitBadgesCollection, GetBrowseCollectionsRouteResponse, NumberType } from "bitbadgesjs-utils";
import { executeCollectionsQuery } from "./collections";

export const getBrowseCollections = async (req: Request, res: Response<GetBrowseCollectionsRouteResponse<NumberType>>) => {
  try {
    //TODO: populate with real data

    const latestQuery: nano.MangoQuery = {
      selector: {
        "_id": { "$gt": null },
        "createdBlock": { "$gt": null }
      },
      sort: [{ "createdBlock": "desc" }],
      limit: 24,
      update: true,
    }

    const latestCollections = await COLLECTIONS_DB.find(latestQuery);


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

    const attendanceCollections = await FETCHES_DB.find(attendanceQuery);

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

    const certificationsCollections = await FETCHES_DB.find(certificationsQuery);

    const uris = [...attendanceCollections.docs.map(x => x._id), ...certificationsCollections.docs.map(x => x._id)];

    const urisForCollectionQuery = await COLLECTIONS_DB.find({
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
    });


    const collections = await executeCollectionsQuery([
      ...latestCollections.docs,
      ...urisForCollectionQuery.docs,
    ].map(doc => {
      return {
        collectionId: doc._id,
        fetchTotalAndMintBalances: true,
        handleAllAndAppendDefaults: true,
        metadataToFetch: {
          badgeIds: [{ start: 1n, end: 10n }],
        },
      }
    }));


    return res.status(200).send({
      // 'featured': collections,
      'latest': latestCollections.docs.map(x => collections.find(y => y.collectionId === x._id)).filter(x => x) as BitBadgesCollection<NumberType>[],
      'attendance': attendanceCollections.docs.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
        attendanceCollections.docs.map(x => x._id).includes(x.collectionMetadata.uri)
      ))).filter(x => x) as BitBadgesCollection<NumberType>[],
      'certifications': certificationsCollections.docs.map(x => collections.find(y => y.collectionMetadataTimeline.find(x =>
        certificationsCollections.docs.map(x => x._id).includes(x.collectionMetadata.uri)
      ))).filter(x => x) as BitBadgesCollection<NumberType>[],

    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error getting collections'
    });
  }
}