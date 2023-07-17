import axios from "axios";
import { BigIntify, DocsCache, FetchMetadataDirectlyRouteRequestBody, FetchMetadataDirectlyRouteResponse, NumberType, RefreshMetadataRouteResponse, convertCollectionDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { getFromIpfs } from "../ipfs/ipfs";
import { getLoadBalancerId } from "../utils/loadBalancer";
import { COLLECTIONS_DB } from "../db/db";
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue, updateRefreshDoc } from "../metadata-queue";
import { serializeError } from "serialize-error";
import { flushCachedDocs } from "../db/cache";

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

    const validRefresh = await updateRefreshDoc(docs, collection.collectionId.toString(), refreshTime);

    await pushCollectionFetchToQueue(docs, collection, getLoadBalancerId(), refreshTime);
    if (collection.balancesType === 'Off-Chain') {
      await pushBalancesFetchToQueue(docs, collection, getLoadBalancerId(), refreshTime);
    }

    await flushCachedDocs(docs);

    return res.status(200).send({
      successMessage: validRefresh ? `Successfully refreshed metadata for collection ${collection.collectionId.toString()}` : `Metadata for collection ${collection.collectionId.toString()} is already being refreshed.`,
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
    //TODO: Only allow this from the BitBadges frontend or from a trusted source with CORS. Should also be rate limited.

    let res: any;
    const reqBody = req.body as FetchMetadataDirectlyRouteRequestBody;
    let uri = reqBody.uri;
    //If we are here, we need to fetch from the source
    if (uri.startsWith('ipfs://')) {
      const _res = await getFromIpfs(uri.replace('ipfs://', ''));
      res = JSON.parse(_res.file);
    } else {
      const _res = await axios.get(uri).then((res) => res.data);
      res = JSON.parse(_res);
    }

    return res.status(200).send({ metadata: res });
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
}