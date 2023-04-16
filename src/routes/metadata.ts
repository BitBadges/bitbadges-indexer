import { Request, Response } from "express";
import { COLLECTIONS_DB } from "../db/db";
import { getStatus, setStatus } from "../db/status";
import { refreshQueueMutex } from "../indexer";
import { fetchUri, pushToMetadataQueue } from "../metadata-queue";

export const refreshMetadata = async (req: Request, res: Response) => {
    try {
        await refreshQueueMutex.runExclusive(async () => {
            const status = await getStatus();
            const collection = await COLLECTIONS_DB.get(req.params.id);
            const specificId = req.params.badgeId ? Number(req.params.badgeId) : req.body.onlyCollectionMetadata ? 'collection' : undefined;
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