import { AddressMappingDoc, AddressMappingWithMetadata, BitBadgesCollection, GetBrowseCollectionsRouteResponse, JSPrimitiveNumberType, Metadata, NumberType, Stringify, convertMetadata } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { ADDRESS_MAPPINGS_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB, TRANSFER_ACTIVITY_DB } from "../db/db";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { executeCollectionsQuery } from "./collections";
import { getAccountByAddress } from "./users";

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


    const collections = await executeCollectionsQuery(req, [
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

    //latest activity
    const activity = await TRANSFER_ACTIVITY_DB.find({
      selector: {
        timestamp: {
          "$gt": null,
        }
      },
      sort: [{ "timestamp": "desc" }],
      limit: 100,
    });

    const addressMappings = await ADDRESS_MAPPINGS_DB.find({
      selector: {
        createdBlock: {
          "$gt": null,
        }
      },
      sort: [{ "createdBlock": "desc" }],
      limit: 100,
    });

    let addressMappingsToReturn: AddressMappingWithMetadata<string>[] = [...addressMappings.docs.map(x => x as AddressMappingDoc<string>).map(removeCouchDBDetails)];
    let mappingUris: string[] = addressMappingsToReturn.map(x => x.uri);
    if (mappingUris.length > 0) {
      for (const uri of mappingUris) {
        if (!uri) continue;
        const doc = await FETCHES_DB.get(uri).catch(catch404);
        console.log(doc);
        if (doc) {
          addressMappingsToReturn = addressMappingsToReturn.map(x => {
            if (x.uri === uri) {
              return {
                ...x,
                metadata: convertMetadata(doc.content as Metadata<JSPrimitiveNumberType>, Stringify),
              }
            } else {
              return x;
            }
          })
        }
      }
    }

    const profiles = await PROFILES_DB.find({
      selector: {
        "profilePicUrl": {
          "$gt": null,
        }
      },
      limit: 25
    });

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
        'featured': allAccounts.map(x => removeCouchDBDetails(x)),
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