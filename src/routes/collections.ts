import { Request, Response } from "express";
import { BadgeMetadata, BadgeMetadataMap } from "../types";
import { COLLECTIONS_DB, METADATA_DB } from "../db/db";
import nano from "nano";

export const getCollectionById = async (req: Request, res: Response) => {
    try {
        const collection = await COLLECTIONS_DB.get(req.params.collectionId);

        return res.json({
            ...collection,
        })
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}

export const getCollections = async (req: Request, res: Response) => {
    try {
        let collectionNumsResponse;

        if (req.body.collections && req.body.collections.length !== 0) {
            const response = await COLLECTIONS_DB.fetch({ keys: req.body.collections.map((num: number) => `${num}`) });
            collectionNumsResponse = response.rows.map((row: any) => row.doc);
        } else {
            collectionNumsResponse = [];
        }

        return res.status(200).send({ collections: [...collectionNumsResponse] });
    } catch (e) {
        console.error(e);
        return res.status(500).send({
            collections: [],
            error: 'Error fetching collections. Please try again later.'
        })
    }
}

export const queryCollections = async (req: Request, res: Response) => {
    try {
        const response = await COLLECTIONS_DB.find({
            selector: req.body.selector
        });

        return res.json({
            collections: response.docs,
        })
    } catch (e) {
        console.error(e);
        return res.status(500).send({
            error: 'Error fetching collections. Please try again later.'
        })
    }
}

export const getMetadataForCollection = async (req: Request, res: Response) => {
    try {
        const LIMIT = 100;
        const startId = Number(req.body.startBatchId);

        //Fetch 100 at a time
        const response = await METADATA_DB.partitionedFind(`${req.params.collectionId}`, {
            selector: {
                "id": {
                    "$and": [
                        {
                            "$gte": startId && !isNaN(startId) ? startId : 0,
                        },
                        {
                            "$lte": startId && !isNaN(startId) ? startId + LIMIT : LIMIT,
                        }
                    ]
                }
            },
            limit: LIMIT + 1,
        })

        let badgeMetadata: BadgeMetadataMap = {};
        let collectionMetadata: BadgeMetadata | undefined = undefined;
        for (const doc of response.docs) {
            const metadataBatchId = doc._id.split(':')[1];
            if (doc.isCollection) {
                collectionMetadata = doc.metadata;
            } else {
                badgeMetadata[metadataBatchId] = {
                    metadata: doc.metadata,
                    badgeIds: doc.badgeIds,
                }
            }
        }

        // console.log(badgeMetadata);

        return res.json({
            collectionMetadata: { ...collectionMetadata },
            badgeMetadata
        })
    } catch (e) {
        console.error(e);
        return res.status(500).send({
            error: 'Error fetching collection metadata. Please try again later.'
        })
    }
}

export const getOwnersForCollection = async (req: Request, res: Response) => {
    try {
        const balanceField = `balances`;

        const q: nano.MangoQuery = {
            selector: {
                _id: req.params.id
            },
            fields: [balanceField]
        };

        const response = await COLLECTIONS_DB.find(q);

        const ownerNums = [];
        if (response.docs[0]) {
            for (const accountNum of Object.keys(response.docs[0].balances)) {
                for (const balance of response.docs[0].balances[accountNum].balances) {
                    for (const badgeId of balance.badgeIds) {
                        if (badgeId.start <= Number(req.params.badgeId) && badgeId.end >= Number(req.params.badgeId)) {
                            ownerNums.push(accountNum);
                        }
                    }
                }
            }
        }

        return res.status(200).send({
            balances: response.docs[0]?.balances ? response.docs[0].balances : [],
            owners: ownerNums,
        });
    } catch (e) {
        return res.status(500).send({ error: e });
    }
}