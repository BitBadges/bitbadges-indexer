import axios from "axios";
import { BigIntify, DocsCache, FetchMetadataDirectlyRouteRequestBody, FetchMetadataDirectlyRouteResponse, NumberType, RefreshMetadataRouteResponse, RefreshStatusRouteResponse, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { flushCachedDocs } from "../db/cache";
import { COLLECTIONS_DB, FETCHES_DB, QUEUE_DB } from "../db/db";
import { getFromIpfs } from "../ipfs/ipfs";
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue, updateRefreshDoc } from "../metadata-queue";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";

export const getRefreshStatus = async (req: Request, res: Response<RefreshStatusRouteResponse<NumberType>>) => {
  try {
    const collectionId = req.params.collectionId;

    const errorDocs = await QUEUE_DB.find({
      selector: {
        collectionId: {
          $eq: Number(collectionId),
        },
        error: {
          $gt: null,
        }
      },
    });
    let inQueue = errorDocs.docs.length > 0;

    if (!inQueue) {
      const docs = await QUEUE_DB.find({
        selector: {
          collectionId: {
            $eq: Number(collectionId),
          },
        },
        limit: 1,
      });

      inQueue = docs.docs.length > 0;
    }

    return res.status(200).send({
      inQueue,
      errorDocs: errorDocs.docs.map((doc) => removeCouchDBDetails(doc)),
    });


  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: `Error getting refresh status: ${e.message}`
    });
  }
}

export const refreshMetadata = async (req: Request, res: Response<RefreshMetadataRouteResponse<NumberType>>) => {
  /**
   * Refreshes metadata for a collection or a specific badge.
   * 
   * Requires the mutex to be controlled to update the metadata queue and prevent data races.
   */
  try {
    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, BigIntify);
    const docs: DocsCache = {
      collections: {},
      accounts: {},
      balances: {},
      merkleChallenges: {},
      approvalsTrackers: {},
      addressMappings: {},
      refreshes: {},
      activityToAdd: [],
      queueDocsToAdd: [],
    }

    let refreshTime = BigInt(Date.now());

    const invalidRefresh = await updateRefreshDoc(docs, collection.collectionId.toString(), refreshTime);

    if (!invalidRefresh) {
      await pushCollectionFetchToQueue(docs, collection, refreshTime);
      if (collection.balancesType === 'Off-Chain') {
        await pushBalancesFetchToQueue(docs, collection, refreshTime);
      }

      await flushCachedDocs(docs);
    } else {
      // return res.status(400).send({
      //   message: `Metadata for collection ${collection.collectionId.toString()} is already being refreshed. Limit one refresh every 60 seconds.`,
      // });

    }

    return res.status(200).send({
      successMessage: `Successfully refreshed metadata for collection ${collection.collectionId.toString()}`
    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: `Error refreshing metadata: ${e.message}`
    });
  }
}

export const fetchMetadataDirectly = async (req: Request, res: Response<FetchMetadataDirectlyRouteResponse<NumberType>>) => {
  try {


    const reqBody = req.body as FetchMetadataDirectlyRouteRequestBody;
    let uris = reqBody.uris;
    // console.log(uris);
    const promises = [];
    for (const uri of uris) {
      promises.push(async () => {
        let metadataRes: any;
        const fetchDoc = await FETCHES_DB.get(uri).catch(catch404);

        if (!fetchDoc) {
          //If we are here, we need to fetch from the source
          if (uri.startsWith('ipfs://')) {
            const _res: any = await getFromIpfs(uri.replace('ipfs://', ''));
            metadataRes = JSON.parse(_res.file);
          } else {
            const _res = await axios.get(uri).then((res) => res.data);
            metadataRes = _res
          }
        } else {
          metadataRes = fetchDoc.content;
        }

        return metadataRes;
      });
    }

    const results = await Promise.all(promises.map(p => p()));

    // console.log(results);

    return res.status(200).send({ metadata: results });
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
}