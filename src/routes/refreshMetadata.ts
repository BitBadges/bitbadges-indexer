import { Request, Response } from "express";
import { COLLECTIONS_DB } from "../db/db";
import { getStatus, setStatus } from "../db/status";
import { refreshQueueMutex } from "../indexer";
import { pushToMetadataQueue } from "../metadata-queue";

export const refreshMetadata = async (req: Request, res: Response) => {
    try {
        await refreshQueueMutex.runExclusive(async () => {
            const status = await getStatus();
            const collection = await COLLECTIONS_DB.get(req.body.collectionId);
            const specificId = req.body.badgeId ? Number(req.body.badgeId) : req.body.onlyCollectionMetadata ? 'collection' : undefined;
            await pushToMetadataQueue(collection, status, specificId);
            await setStatus(status);
        });

        return res.status(200).send({ message: 'Added to queue' });
    } catch (e) {
        return res.status(500).send({ message: e.message });
    }
}