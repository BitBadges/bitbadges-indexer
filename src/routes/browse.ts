import { Request, Response } from "express";
import nano from "nano";
import { COLLECTIONS_DB } from "../db/db";

export const getBrowseCollections = async (req: Request, res: Response) => {
    try {

        //TODO: make these queries fucntional
        const latestQuery: nano.MangoQuery = {
            selector: {
                "_id": { "$gt": null },
                "createdBlock": { "$gt": null }
            },
        }

        const latestCollections = await COLLECTIONS_DB.find(latestQuery);

        return res.status(200).send({ collections: latestCollections.docs });
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}