import { Request, Response } from "express";
import nano from "nano";
import { COLLECTIONS_DB } from "../db/db";
import { serializeError } from "serialize-error";
import { GetBrowseCollectionsRouteResponse, NumberType } from "bitbadgesjs-utils";
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

    const collections = await executeCollectionsQuery(latestCollections.docs.map(doc => {
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
      'featured': collections,
      'latest': collections,
      'claimable': collections,
      'popular': collections,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error getting collections'
    });
  }
}