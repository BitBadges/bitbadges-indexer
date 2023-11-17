import { BigIntify, DocsCache, NumberType, RefreshMetadataRouteResponse, RefreshStatusRouteResponse, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { flushCachedDocs } from "../db/cache";
import { COLLECTIONS_DB, QUEUE_DB } from "../db/db";
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue, updateRefreshDoc } from "../queue";
import { removeCouchDBDetails } from "../utils/couchdb-utils";

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

export const refreshCollection = async (collectionId: string, forceful?: boolean) => {
  const _collection = await COLLECTIONS_DB.get(collectionId);
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
    passwordDocs: {},
    claimAlertsToAdd: [],
    queueDocsToAdd: [],
  }

  let refreshTime = BigInt(Date.now());

  const invalidRefresh = await updateRefreshDoc(docs, collection.collectionId.toString(), refreshTime, forceful);

  if (!invalidRefresh) {
    await pushCollectionFetchToQueue(docs, collection, refreshTime);
    if (collection.balancesType === 'Off-Chain') {
      await pushBalancesFetchToQueue(docs, collection, refreshTime);
    }

    await flushCachedDocs(docs);

    return 0;
  } else {
    return invalidRefresh;
  }
}

export const refreshMetadata = async (req: Request, res: Response<RefreshMetadataRouteResponse<NumberType>>) => {
  /**
   * Refreshes metadata for a collection or a specific badge.
   * 
   * Requires the mutex to be controlled to update the metadata queue and prevent data races.
   */
  try {
    const cooldownSeconds = await refreshCollection(req.params.collectionId);

    if (cooldownSeconds) {
      throw new Error(`Refresh already in progress or recently executed for collection ${req.params.collectionId}. Cooldown timer has ${cooldownSeconds / BigInt(1000)} seconds left.`);
    } else {
      return res.status(200).send({
        successMessage: `Successfully refreshed metadata for collection ${req.params.collectionId}`
      });
    }


  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: `Error refreshing metadata: ${e.message}`
    });
  }
}