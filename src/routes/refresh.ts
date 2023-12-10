import { BigIntify, DocsCache, NumberType, RefreshMetadataRouteResponse, RefreshStatusRouteResponse, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { flushCachedDocs } from "../db/cache";
import { CollectionModel, MongoDB, QueueModel, mustGetFromDB } from "../db/db";
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue, updateRefreshDoc } from "../queue";

export const getRefreshStatus = async (req: Request, res: Response<RefreshStatusRouteResponse<NumberType>>) => {
  try {
    const collectionId = req.params.collectionId;

    const errorDocs = await QueueModel.find({
      collectionId: Number(collectionId),
      error: { $exists: true },
    }).limit(100).lean().exec();

    let inQueue = errorDocs.length > 0;

    if (!inQueue) {
      const docs = await QueueModel.find({
        collectionId: Number(collectionId),
      }).limit(1).lean().exec();

      inQueue = docs.length > 0;
    }

    return res.status(200).send({
      inQueue,
      errorDocs: errorDocs,
    });


  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: `Error getting refresh status: ${e.message}`
    });
  }
}

export const refreshCollection = async (collectionId: string, forceful?: boolean) => {
  const _collection = await mustGetFromDB(CollectionModel, collectionId);
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
    const session = await MongoDB.startSession();
    try {
      session.startTransaction();
      await flushCachedDocs(session, docs);
      await session.commitTransaction();
      await session.endSession();
    } catch (e) {
      await session.abortTransaction();
      await session.endSession();
      throw e;
    }

    return 0;
  } else {
    return invalidRefresh;
  }
}

export const refreshMetadata = async (req: Request, res: Response<RefreshMetadataRouteResponse<NumberType>>) => {
  /**
   * Refreshes metadata for a collection or a specific badge.
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