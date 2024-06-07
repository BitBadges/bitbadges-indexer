import {
  BigIntify,
  type ErrorResponse,
  type iRefreshMetadataSuccessResponse,
  type iRefreshStatusSuccessResponse,
  type NumberType
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { mustGetFromDB } from '../db/db';
import { CollectionModel, QueueModel, RefreshModel } from '../db/schemas';
import { flushCachedDocs } from '../db/cache';
import { type DocsCache } from '../db/types';
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue, updateRefreshDoc } from '../queue';
import { findInDB } from '../db/queries';
import typia from 'typia';

export const getRefreshStatus = async (req: Request, res: Response<iRefreshStatusSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const collectionId = req.params.collectionId;
    typia.assert<NumberType>(collectionId);
    BigIntify(collectionId);

    const errorDocs = await findInDB(QueueModel, {
      query: {
        collectionId: Number(collectionId),
        error: { $exists: true },
        deletedAt: { $exists: false },
        notificationType: { $exists: false }
      },
      limit: 20
    });
    let inQueue = errorDocs.length > 0;

    if (!inQueue) {
      const docs = await findInDB(QueueModel, {
        query: { collectionId: Number(collectionId) },
        limit: 1
      });
      inQueue = docs.length > 0;
    }

    return res.status(200).send({
      inQueue,
      errorDocs,
      refreshDoc: await mustGetFromDB(RefreshModel, collectionId)
    });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: `Error getting refresh status: ${e.message}`
    });
  }
};

export const refreshCollection = async (collectionId: string, forceful?: boolean) => {
  const collection = await mustGetFromDB(CollectionModel, collectionId);
  const docs: DocsCache = {
    collections: {},
    accounts: {},
    balances: {},
    merkleChallenges: {},
    approvalTrackers: {},
    addressLists: {},
    refreshes: {},
    activityToAdd: [],
    claimBuilderDocs: {},
    claimAlertsToAdd: [],
    queueDocsToAdd: [],
    maps: {}
  };

  const refreshTime = BigInt(Date.now());

  const invalidRefresh = await updateRefreshDoc(docs, collection.collectionId.toString(), refreshTime, forceful);

  if (!invalidRefresh) {
    await pushCollectionFetchToQueue(docs, collection, refreshTime);
    if (collection.balancesType === 'Off-Chain - Indexed') {
      await pushBalancesFetchToQueue(docs, collection, refreshTime);
    }

    await flushCachedDocs(docs);

    return 0;
  } else {
    return invalidRefresh;
  }
};

export const refreshMetadata = async (req: Request, res: Response<iRefreshMetadataSuccessResponse | ErrorResponse>) => {
  /**
   * Refreshes metadata for a collection or a specific badge.
   *
   * Not forceful: If a refresh is already in progress or has been recently executed, this will return an error.
   */
  try {
    typia.assert<NumberType>(req.params.collectionId);
    BigIntify(req.params.collectionId);

    const cooldownSeconds = await refreshCollection(req.params.collectionId);
    if (cooldownSeconds) {
      throw new Error(
        `Refresh already in progress or recently executed for collection ${req.params.collectionId}. Cooldown timer has ${cooldownSeconds / BigInt(1000)} seconds left.`
      );
    } else {
      return res.status(200).send();
    }
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: `Error refreshing metadata: ${e.message}`
    });
  }
};
