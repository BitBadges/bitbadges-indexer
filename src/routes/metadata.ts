import { Request, Response } from "express";
import { COLLECTIONS_DB } from "../db/db";
import { getStatus, setStatus } from "../db/status";
import { refreshQueueMutex } from "../indexer";
import { fetchUri, pushToMetadataQueue } from "../metadata-queue";
import { convertToCollection } from "bitbadgesjs-utils";

export const refreshMetadata = async (req: Request, res: Response) => {
  /**
   * Refreshes metadata for a collection or a specific badge.
   * 
   * Requires the mutex to be controlled to update the metadata queue and prevent data races.
   */
  try {
    await refreshQueueMutex.runExclusive(async () => {
      const status = await getStatus();
      const _collection = await COLLECTIONS_DB.get(req.params.id);
      const collection = convertToCollection(_collection);
      const specificId = req.params.badgeId ? BigInt(req.params.badgeId) : req.body.onlyCollectionMetadata ? 'collection' : undefined;
      await pushToMetadataQueue(collection, status, specificId);
      await setStatus(status);
    });

    return res.status(200).send({ message: 'Added to queue' });
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
}

export const fetchMetadata = async (req: Request, res: Response) => {
  try {
    const metadataRes = await fetchUri(req.body.uri);
    return res.status(200).send({ metadata: metadataRes });
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
}