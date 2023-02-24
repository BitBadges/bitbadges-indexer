import { COLLECTIONS_DB, METADATA_DB } from "../db/db";
import { getDoc } from "../db/helpers";
import { Request, Response } from "express";
import { BadgeMetadata } from "src/types";

export const getCollectionById = async (req: Request, res: Response) => {
    const collection = await getDoc(COLLECTIONS_DB, req.params.id);

    return res.json({
        ...collection,
    })
}

export const getCollections = async (req: Request, res: Response) => {
    let collectionNumsResponse;

    if (req.body.collections && req.body.collections.length !== 0) {
        const response = await COLLECTIONS_DB.fetch({ keys: req.body.collections.map((num: number) => `${num}`) });
        collectionNumsResponse = response.rows.map((row: any) => row.doc);
    } else {
        collectionNumsResponse = [];
    }

    return res.status(200).send({ collections: [...collectionNumsResponse] });
}

export const queryCollections = async (req: Request, res: Response) => {
    const response = await COLLECTIONS_DB.find({
        selector: req.body.selector
    });

    res.json({
        collections: response.docs,
    })
}

export const getMetadataForCollection = async (req: Request, res: Response) => {
    const collectionMetadata = await getDoc(METADATA_DB, `${req.params.collectionId}:collection`);
    const LIMIT = 100;
    const startId = Number(req.body.startBadgeId);

    const response = await METADATA_DB.partitionedFind(`${req.params.collectionId}`, {
        selector: {
            "id": {
                "$and": [
                    {
                        "$gte": startId && !isNaN(startId) ? startId : 1,
                    },
                    {
                        "$lte": startId && !isNaN(startId) ? startId + LIMIT - 1 : LIMIT,
                    }
                ]
            }
        }, limit: LIMIT
    })

    let badgeMetadata: { [badgeId: string]: BadgeMetadata } = {};
    for (const doc of response.docs) {
        const badgeId = doc._id.split(':')[1];
        badgeMetadata[badgeId] = doc;
    }

    return res.json({
        collectionMetadata: { ...collectionMetadata },
        badgeMetadata
    })
}

export const getOwnersForCollection = async (req: Request, res: Response) => {
    const balanceField = `balances`;

    const q: any = {};
    q.selector = {
        _id: req.params.id
    }
    q.fields = [balanceField];

    const response = await COLLECTIONS_DB.find(q);

    //TODO: this should be in Mango query somehow and not on backend

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

    if (ownerNums.length === 0) {
        return res.status(200).send({
            owners: [],
            balances: response.docs[0].balances,
        });
    }

    return res.status(200).send({
        balances: response.docs[0].balances,
        owners: ownerNums,
    });
}