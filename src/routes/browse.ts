import { Request, Response } from "express";
import nano from "nano";
import { COLLECTIONS_DB } from "../db/db";

export const getBrowseCollections = async (req: Request, res: Response) => {
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


        return res.status(200).send({
            'featured': latestCollections.docs,
            'latest': latestCollections.docs,
            'claimable': latestCollections.docs,
            'popular': latestCollections.docs
        });
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: 'Error fetching collections' });
    }
}