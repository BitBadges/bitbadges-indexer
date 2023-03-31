import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, COLLECTIONS_DB, METADATA_DB } from "../db/db";
import { BadgeCollection, BadgeMetadata, BadgeMetadataMap, AccountDocument, convertToBitBadgesUserInfo } from "bitbadges-sdk";

export const getCollectionById = async (req: Request, res: Response) => {
    try {
        const promises = [];
        promises.push(COLLECTIONS_DB.get(req.params.id));
        promises.push(getMetadata(Number(req.params.id), 0));

        const results = await Promise.all(promises);
        const collection = results[0] as nano.DocumentGetResponse & BadgeCollection;

        const metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap } = results[1] as { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap };

        const appendedCollection = appendMetadataResToCollection(metadataRes, collection);
        collection.badgeMetadata = appendedCollection.badgeMetadata;
        collection.collectionMetadata = appendedCollection.collectionMetadata;

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
        let collectionNumsResponse: BadgeCollection[];

        //Here, we fetch the collections from the database and initial metadata if startBatchId is defined
        if (req.body.collections && req.body.collections.length !== 0) {
            const keys = [];
            const metadataFetches: { collectionId: number, startBatchId: number }[] = [];
            for (let i = 0; i < req.body.collections.length; i++) {
                keys.push(`${req.body.collections[i]}`);
                if (req.body.startBatchIds && req.body.startBatchIds[i] >= 0) {
                    metadataFetches.push({ collectionId: req.body.collections[i], startBatchId: req.body.startBatchIds[i] });
                }
            }

            //promises[0] will be the collection fetch
            //promises[1...] will be the metadata fetches
            const promises = [];
            promises.push(COLLECTIONS_DB.fetch({ keys }));
            for (const metadataFetch of metadataFetches) {
                promises.push(getMetadata(metadataFetch.collectionId, metadataFetch.startBatchId));
            }

            const responses = await Promise.all(promises);
            const collectionResponse: nano.DocumentFetchResponse<BadgeCollection> = responses[0] as nano.DocumentFetchResponse<BadgeCollection>;
            collectionNumsResponse = collectionResponse.rows.map((row: any) => row.doc);

            //Append the metadata responses to each collection
            for (let i = 1; i < responses.length; i++) {
                const metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap } = responses[i] as { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap };

                let collectionIdx = collectionNumsResponse.findIndex((collection) => collection.collectionId === metadataFetches[i - 1].collectionId);
                if (collectionIdx == -1) continue;

                const appendedCollection = appendMetadataResToCollection(metadataRes, collectionNumsResponse[collectionIdx]);
                collectionNumsResponse[collectionIdx].badgeMetadata = appendedCollection.badgeMetadata;
                collectionNumsResponse[collectionIdx].collectionMetadata = appendedCollection.collectionMetadata;
            }
        } else {
            collectionNumsResponse = [];
        }

        //Fetch the managers' account information
        let keys = [];
        for (const collection of collectionNumsResponse) {
            const managerAccountNumber: any = collection.manager;
            keys.push(`${managerAccountNumber}`);
        }
        keys = [...new Set(keys)];

        const accountsResponseDocs = await ACCOUNTS_DB.fetch({ keys }).then((response) => {
            return response.rows.map((row: any) => row.doc);
        });

        //Append fetched account information to the collection
        for (let i = 0; i < collectionNumsResponse.length; i++) {
            const managerAccountNumber: any = collectionNumsResponse[i].manager;
            const managerInfo = accountsResponseDocs.find((account: AccountDocument) => account.account_number === managerAccountNumber);
            collectionNumsResponse[i].manager = convertToBitBadgesUserInfo(managerInfo) as any;
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

const getMetadata = async (collectionId: number, startBatchId: number) => {
    const LIMIT = 100;
    const startId = Number(startBatchId);

    //Fetch 100 at a time
    const response = await METADATA_DB.partitionedFind(`${collectionId}`, {
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
                uri: doc.uri
            }
        }
    }

    return {
        collectionMetadata: { ...collectionMetadata },
        badgeMetadata
    }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap }, collection: BadgeCollection) => {
    const isCollectionMetadataResEmpty = Object.keys(metadataRes.collectionMetadata).length === 0;
    collection.collectionMetadata = !isCollectionMetadataResEmpty ? metadataRes.collectionMetadata : collection.collectionMetadata;
    collection.badgeMetadata = {
        ...collection.badgeMetadata,
        ...metadataRes.badgeMetadata
    };

    return collection;
}

export const getMetadataForCollection = async (req: Request, res: Response) => {
    try {
        const metadata = await getMetadata(Number(req.params.collectionId), Number(req.body.startBatchId));
        return res.json(metadata)
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