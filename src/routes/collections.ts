import { AccountDocument, AnnouncementActivityItem, BadgeMetadata, BadgeMetadataMap, BitBadgeCollection, IdRange, PaginationInfo, ReviewActivityItem, SortIdRangesAndMergeIfNecessary, StoredBadgeCollection, TransferActivityItem, convertToBitBadgesUserInfo, updateMetadataMap } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { ACCOUNTS_DB, ACTIVITY_DB, COLLECTIONS_DB, METADATA_DB } from "../db/db";
import { getStatus } from "../db/status";

async function executeActivityQuery(collectionId: string, bookmark?: string, badgeId?: string) {
    const activityRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
        selector: {
            method: {
                "$or": [
                    {
                        "$eq": "Transfer"
                    },
                    {
                        "$eq": "Mint"
                    }
                ]
            },
            timestamp: {
                "$gt": null,
            },
            "balances": badgeId ? {
                "$elemMatch": {
                    "badgeIds": {
                        "$elemMatch": {
                            "$and": [
                                {
                                    "start": {
                                        "$lte": Number(badgeId)
                                    }
                                },
                                {
                                    "end": {
                                        "$gte": Number(badgeId)
                                    }
                                }
                            ]
                        }
                    }
                }
            } : {
                "$gt": null
            },
        },
        sort: ["timestamp"],
        bookmark: bookmark ? bookmark : undefined,
    }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

    return activityRes;
}

async function executeAnnouncementsQuery(collectionId: string, bookmark?: string) {
    const announcementsRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
        selector: {
            method: {
                $eq: 'Announcement'
            },
            timestamp: {
                "$gt": null,
            }
        },
        sort: ["timestamp"],
        bookmark: bookmark ? bookmark : undefined,
    }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

    return announcementsRes;
}

async function executeReviewsQuery(collectionId: string, bookmark?: string) {
    const reviewsRes = await ACTIVITY_DB.partitionedFind('collection-' + collectionId, {
        selector: {
            method: {
                $eq: 'Review'
            },
            timestamp: {
                "$gt": null,
            }
        },
        sort: ["timestamp"],
        bookmark: bookmark ? bookmark : undefined,
    }) as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

    return reviewsRes;
}

export const getCollectionById = async (req: Request, res: Response) => {
    try {
        //We assume they already have the collection (they got it from the first request)
        if (req.body.activityBookmark) {
            const activityRes = await executeActivityQuery(req.params.id, req.body.activityBookmark);

            const collection: BitBadgeCollection = {} as BitBadgeCollection;
            collection.activity = activityRes.docs as TransferActivityItem[];

            return res.json({
                pagination: {
                    activity: {
                        bookmark: activityRes.bookmark,
                        hasMore: activityRes.docs.length === 25,
                    }
                },
                collection: collection,
            })
        } else if (req.body.announcementsBookmark) {
            const announcementsRes = await executeAnnouncementsQuery(req.params.id, req.body.announcementsBookmark);

            const collection: BitBadgeCollection = {} as BitBadgeCollection;
            collection.announcements = announcementsRes.docs as AnnouncementActivityItem[];

            return res.json({
                pagination: {
                    announcements: {
                        bookmark: announcementsRes.bookmark,
                        hasMore: announcementsRes.docs.length === 25,
                    }
                },
                collection: collection,
            })
        } else if (req.body.reviewsBookmark) {
          const reviewsRes = await executeReviewsQuery(req.params.id, req.body.reviewsBookmark);

          const collection: BitBadgeCollection = {} as BitBadgeCollection;
          collection.reviews = reviewsRes.docs as ReviewActivityItem[];

          return res.json({
              pagination: {
                  reviews: {
                      bookmark: reviewsRes.bookmark,
                      hasMore: reviewsRes.docs.length === 25,
                  }
              },
              collection: collection,
          })
      }

        //Else we fetch the whole collection, along with initial activity and announcements
        const promises = [];
        promises.push(COLLECTIONS_DB.get(req.params.id));
        promises.push(executeActivityQuery(req.params.id));
        promises.push(executeAnnouncementsQuery(req.params.id));
        promises.push(executeReviewsQuery(req.params.id));
        promises.push(getMetadata(Number(req.params.id), 0));

        const results = await Promise.all(promises);
        const collection = results[0] as nano.DocumentGetResponse & StoredBadgeCollection & { activity: TransferActivityItem[], announcements: AnnouncementActivityItem[], reviews: ReviewActivityItem[] };
        const activityRes = results[1] as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;
        const announcementsRes = results[2] as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;
        const reviewsRes = results[3] as nano.MangoResponse<AnnouncementActivityItem | TransferActivityItem | ReviewActivityItem>;

        collection.activity = activityRes.docs as TransferActivityItem[];
        collection.announcements = announcementsRes.docs as AnnouncementActivityItem[];
        collection.reviews = reviewsRes.docs as ReviewActivityItem[];

        const metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap } = results[4] as { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap };

        const appendedCollection = appendMetadataResToCollection(metadataRes, collection);
        collection.badgeMetadata = appendedCollection.badgeMetadata;
        collection.collectionMetadata = appendedCollection.collectionMetadata;

        return res.json({
            pagination: {
                activity: {
                    bookmark: activityRes.bookmark,
                    hasMore: activityRes.docs.length === 25,
                },
                announcements: {
                    bookmark: announcementsRes.bookmark,
                    hasMore: announcementsRes.docs.length === 25,
                },
                reviews: {
                    bookmark: reviewsRes.bookmark,
                    hasMore: reviewsRes.docs.length === 25,
                }
            },
            collection: {
                ...collection,
            }
        })
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: 'Error fetching collection' });
    }
}

export const getBadgeActivity = async (req: Request, res: Response) => {
    try {
        const activityRes = await executeActivityQuery(req.params.id, req.body.bookmark, req.params.badgeId);

        return res.json({
            pagination: {
                activity: {
                    bookmark: activityRes.bookmark,
                    hasMore: activityRes.docs.length === 25,
                }
            },
            activity: activityRes.docs as TransferActivityItem[],
        })
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: 'Error fetching badge activity' });
    }
}

export const getCollections = async (req: Request, res: Response) => {
    try {
        let collectionNumsResponse: (StoredBadgeCollection & { activity: TransferActivityItem[], announcements: AnnouncementActivityItem[], reviews: ReviewActivityItem[] })[];
        let paginations: { activity: PaginationInfo, announcements: PaginationInfo, reviews: PaginationInfo }[] = [];
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

            //promises[0] will be the collection fetches
            //promises[1...] will be the metadata and activity fetches
            const promises = [];
            promises.push(COLLECTIONS_DB.fetch({ keys }));

            for (const metadataFetch of metadataFetches) {
                promises.push(getMetadata(metadataFetch.collectionId, metadataFetch.startBatchId));
                promises.push(executeActivityQuery(`${metadataFetch.collectionId}`));
                promises.push(executeAnnouncementsQuery(`${metadataFetch.collectionId}`));
                promises.push(executeReviewsQuery(`${metadataFetch.collectionId}`));
            }

            const responses = await Promise.all(promises);

            const collectionResponse: nano.DocumentFetchResponse<StoredBadgeCollection> = responses[0] as nano.DocumentFetchResponse<StoredBadgeCollection>;
            collectionNumsResponse = collectionResponse.rows.map((row: any) => row.doc);
            paginations = new Array(collectionNumsResponse.length);


            //Append the metadata responses to each collection
            let idx = 1;
            for (let i = 1; i < responses.length; i += 4) {
                const metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap } = responses[i] as { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap };

                let collectionIdx = collectionNumsResponse.findIndex((collection) => collection.collectionId === metadataFetches[idx - 1].collectionId);
                if (collectionIdx == -1) continue;

                const appendedCollection = appendMetadataResToCollection(metadataRes, collectionNumsResponse[collectionIdx]);
                collectionNumsResponse[collectionIdx].badgeMetadata = appendedCollection.badgeMetadata;
                collectionNumsResponse[collectionIdx].collectionMetadata = appendedCollection.collectionMetadata;

                //Append the activity responses to each collection
                const activityRes = responses[i + 1] as nano.MangoResponse<TransferActivityItem | AnnouncementActivityItem | ReviewActivityItem>;
                const announcementsRes = responses[i + 2] as nano.MangoResponse<TransferActivityItem | AnnouncementActivityItem | ReviewActivityItem>;
                const reviewsRes = responses[i + 3] as nano.MangoResponse<TransferActivityItem | AnnouncementActivityItem | ReviewActivityItem>;
                collectionNumsResponse[collectionIdx].activity = activityRes.docs as TransferActivityItem[];
                collectionNumsResponse[collectionIdx].announcements = announcementsRes.docs as AnnouncementActivityItem[];
                collectionNumsResponse[collectionIdx].reviews = reviewsRes.docs as ReviewActivityItem[];
                paginations[collectionIdx] = {
                    activity: {
                        bookmark: activityRes.bookmark || '',
                        hasMore: activityRes.docs.length === 25
                    },
                    announcements: {
                        bookmark: announcementsRes.bookmark || '',
                        hasMore: announcementsRes.docs.length === 25
                    },
                    reviews: {

                        bookmark: reviewsRes.bookmark || '',
                        hasMore: reviewsRes.docs.length === 25
                    }
                }

                idx++;
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

        return res.status(200).send({ collections: [...collectionNumsResponse], paginations });
    } catch (e) {
        console.error(e);
        console.log("TESTING");
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
        if (doc.isCollection) {
            collectionMetadata = doc.metadata;
        } else {
            for (const badgeId of doc.badgeIds) {
                badgeMetadata = updateMetadataMap(badgeMetadata, doc.metadata, badgeId, doc.uri);
            }
        }
    }

    return {
        collectionMetadata: { ...collectionMetadata },
        badgeMetadata
    }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata: BadgeMetadata, badgeMetadata: BadgeMetadataMap }, collection: StoredBadgeCollection) => {
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
        const metadata = await getMetadata(Number(req.params.id), Number(req.body.startBatchId));
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
                            ownerNums.push({
                                accountNum,
                                balance: balance.balance
                            });
                        }
                    }
                }
            }
        }

        return res.status(200).send({
            balances: response.docs[0]?.balances ? response.docs[0].balances : [],
            owners: ownerNums.sort((a, b) => b.balance - a.balance).map(x => x.accountNum)
        });
    } catch (e) {
        return res.status(500).send({ error: e });
    }
}

export const addReview = async (expressReq: Request, res: Response) => {
    try {
        const req = expressReq as AuthenticatedRequest

        if (!req.body.review || req.body.review.length > 2048) {
            return res.status(400).send({ error: 'Review must be 1 to 2048 characters long.' });
        }

        const stars = Number(req.body.stars);
        if (isNaN(stars) || stars < 0 || stars > 5) {
            return res.status(400).send({ error: 'Stars must be a number between 0 and 5.' });
        }
        const collectionId = Number(req.params.id);

       
        const userAccountInfo = await ACCOUNTS_DB.find({
            selector: {
                cosmosAddress: {
                    $eq: req.session.cosmosAddress
                }
            }
        });

        if (userAccountInfo.docs.length === 0) {
            return res.status(400).send({ error: 'User does not exist.' });
        }


        const status = await getStatus();

        const { review } = req.body;




        const activityDoc: ReviewActivityItem & {
            _id: string
        } = {
            _id: `collection-${collectionId}:${Date.now()}`,
            method: 'Review',
            collectionId,
            stars: stars,
            review: review,
            from: userAccountInfo.docs[0].account_number,
            timestamp: Date.now(),
            block: status.block.height,
            users: [],
        }

        await ACTIVITY_DB.insert(activityDoc);

        return res.status(200).send({ success: true });
    } catch (e) {
        console.error(e);
        return res.status(500).send({
            error: 'Error adding announcement. Please try again later.'
        })
    }
}

export const addAnnouncement = async (expressReq: Request, res: Response) => {
    try {
        const req = expressReq as AuthenticatedRequest

        if (!req.body.announcement || req.body.announcement.length > 2048) {
            return res.status(400).send({ error: 'Announcement must be 1 to 2048 characters long.' });
        }

        const collectionId = Number(req.params.id);

        const collection = await COLLECTIONS_DB.get(`${collectionId}`);
        const manager = collection.manager;


        const managerAccountInfo = await ACCOUNTS_DB.get(`${manager}`);
        if (managerAccountInfo.cosmosAddress !== req.session.cosmosAddress) {
            return res.status(401).send({ error: 'Unauthorized. Must be manager of this collection.' });
        }

        const status = await getStatus();

        const { announcement } = req.body;

        let allUsersThatOwn: IdRange[] = [];
        for (const accountId of Object.keys(collection.balances)) {
            if (collection.balances[accountId].balances.length > 0) {
                allUsersThatOwn.push({
                    start: Number(accountId),
                    end: Number(accountId)
                })
            }
        }
        allUsersThatOwn = SortIdRangesAndMergeIfNecessary(allUsersThatOwn);


        const activityDoc: AnnouncementActivityItem & {
            _id: string
        } = {
            _id: `collection-${collectionId}:${Date.now()}`,
            method: 'Announcement',
            collectionId,
            announcement,
            from: manager,
            timestamp: Date.now(),
            block: status.block.height,
            users: allUsersThatOwn,
        }

        await ACTIVITY_DB.insert(activityDoc);

        return res.status(200).send({ success: true });
    } catch (e) {
        console.error(e);
        return res.status(500).send({
            error: 'Error adding announcement. Please try again later.'
        })
    }
}
