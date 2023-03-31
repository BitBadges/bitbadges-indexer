import { METADATA_DB, fetchDocsForRequestIfEmpty } from "./db/db";
import axios from "axios";
import { getFromIpfs } from "./ipfs/ipfs";
import { BadgeCollection, DbStatus, Docs, BadgeMetadata } from "bitbadges-sdk";

export const fetchUri = async (uri: string): Promise<any> => {
    if (uri.startsWith('ipfs://')) {
        const res = await getFromIpfs(uri.replace('ipfs://', ''));
        return JSON.parse(res.file);
    } else {
        const res = await axios.get(uri).then((res) => res.data);
        return res;
    }
}

export const pushToMetadataQueue = async (_collection: BadgeCollection, status: DbStatus, specificId?: number | 'collection') => {
    const collection: BadgeCollection = JSON.parse(JSON.stringify(_collection));

    let batchId = 0;

    let pushed = false;
    let alreadyPurging = false;
    //If already in queue somewhere, don't add it again
    const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startingBatchId === batchId);
    if (!existing) {
        const toPush = !specificId || (specificId && specificId == 'collection');
        if (toPush) {
            status.queue.push({
                uri: collection.collectionUri,
                collectionId: collection.collectionId,
                collection: true,
                badgeIds: [],
                batchId: 0,
                numCalls: 0,
                startingBatchId: batchId,
            });
            pushed = true;
        }
    } else if (existing.purge) {
        alreadyPurging = true;
    }
    batchId++;

    for (const badgeUri of collection.badgeUris) {
        if (badgeUri.uri.includes('{id}')) {
            for (const badgeIdRange of badgeUri.badgeIds) {
                const toPush = !specificId || (specificId && specificId !== 'collection' && specificId >= badgeIdRange.start && specificId <= badgeIdRange.end);
                const specificIdToAdd = toPush && specificId ? specificId : undefined;
                const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startingBatchId === batchId && q.specificId === specificIdToAdd);
                if (!existing) {
                    if (toPush) {
                        status.queue.push({
                            uri: badgeUri.uri,
                            collectionId: collection.collectionId,
                            collection: false,
                            badgeIds: [badgeIdRange],
                            batchId: batchId,
                            startingBatchId: batchId,
                            numCalls: 0,
                            specificId: specificIdToAdd,
                        });
                        pushed = true;
                    }
                } else if (existing.purge) {
                    alreadyPurging = true;
                }
                batchId += Number(badgeIdRange.end) - Number(badgeIdRange.start) + 1;
            }
        } else {
            const toPush = !specificId || (specificId && specificId !== 'collection' && badgeUri.badgeIds.find((id) => id.start <= specificId && id.end >= specificId));
            const specificIdToAdd = toPush && specificId ? specificId : undefined;
            const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startingBatchId === batchId && q.specificId === specificIdToAdd);
            if (!existing) {
                if (toPush) {
                    status.queue.push({
                        uri: badgeUri.uri,
                        collectionId: collection.collectionId,
                        collection: false,
                        badgeIds: badgeUri.badgeIds,
                        batchId: batchId,
                        numCalls: 0,
                        specificId: toPush && specificId ? specificId : undefined,
                        startingBatchId: batchId,
                    });
                    pushed = true;
                }
            } else {
                if (existing.purge) {
                    alreadyPurging = true;
                }
            }
            batchId++;
        }
    }

    if (pushed && !specificId && !alreadyPurging) {
        status.queue[status.queue.length - 1].purge = true;
    }
}

//Assumes the metadata queue mutex is already obtained
export const fetchUriInQueue = async (status: DbStatus, docs: Docs) => {
    const NUM_METADATA_FETCHES_PER_BLOCK = 10;
    const MAX_NUM_CALLS_PER_URI = 1000;

    //TODO: we have redundances with addToIpfs (we can save resources by storing the metadata when adding it and never having to re-fetch it)

    let numFetchesLeft = NUM_METADATA_FETCHES_PER_BLOCK;
    let metadataIdsToFetch: string[] = [];

    const queueItems = [];
    while (numFetchesLeft > 0 && status.queue.length > 0) {


        //Handle if we are only fetching a specific badgeID
        if (status.queue[0].specificId && status.queue[0].batchId !== 'collection') {
            const matchingIdRange = status.queue[0].badgeIds.find((id) => {
                if (status.queue[0].specificId) return id.start <= status.queue[0].specificId && id.end >= status.queue[0].specificId

                return false;
            });

            if (matchingIdRange) status.queue[0].batchId += status.queue[0].specificId - matchingIdRange.start;
            status.queue[0].badgeIds = [{ start: status.queue[0].specificId, end: status.queue[0].specificId }];
        }

        metadataIdsToFetch.push(`${status.queue[0].collectionId}:${status.queue[0].batchId}`);
        const queueItem = status.queue[0];

        if (queueItem) queueItems.push(JSON.parse(JSON.stringify(queueItem)));

        if (queueItem.uri.includes('{id}') && !queueItem.collection) {
            status.queue[0].numCalls++;

            //Should only be one badgeId[]
            status.queue[0].badgeIds.forEach((badgeIdRange) => {
                badgeIdRange.start++;
            });
            if (status.queue[0].batchId !== 'collection') status.queue[0].batchId++;

            //If we have reached the end of the range, remove it from the queue
            if (status.queue[0].badgeIds[0].start > status.queue[0].badgeIds[0].end) {
                //Fetch and purge all entries for this collection
                if (status.queue[0].purge) {
                    // const res = await METADATA_DB.partitionedList(`${status.queue[0].collectionId}`);
                    const info = await METADATA_DB.partitionInfo(`${status.queue[0].collectionId}`);
                    console.log(info);

                    // console.log(res.rows);
                    // console.log(res);
                    const lastBatchIdToPurge = info.doc_count + info.doc_del_count - 1;
                    const startBatchIdToPurge = status.queue[0].batchId !== 'collection' ? status.queue[0].batchId : 1;


                    console.log('PURGING', startBatchIdToPurge, lastBatchIdToPurge);
                    for (let i = startBatchIdToPurge; i <= lastBatchIdToPurge; i++) { //This was already incremented
                        metadataIdsToFetch.push(`${status.queue[0].collectionId}:${i}`);
                    }
                }
                status.queue.shift();
            } else if (status.queue[0].numCalls > MAX_NUM_CALLS_PER_URI) {
                //If we have made more than MAX_NUM_CALLS_PER_URI calls to the same URI, place it at the end of the queue
                const queueItem = status.queue.shift();
                if (queueItem) status.queue.push(queueItem);
            }
        } else {
            //Fetch and purge all entries for this collection
            if (status.queue[0].purge) {
                // const res = await METADATA_DB.partitionedList(`${status.queue[0].collectionId}`);
                const info = await METADATA_DB.partitionInfo(`${status.queue[0].collectionId}`);
                console.log(info);

                // console.log(res.rows);
                // console.log(res);
                const lastBatchIdToPurge = info.doc_count + info.doc_del_count - 1;
                const startBatchIdToPurge = status.queue[0].batchId !== 'collection' ? status.queue[0].batchId + 1 : 1;

                console.log('PURGING', `${status.queue[0].collectionId}`);
                console.log("TOTAL_ROWS", info.doc_count + info.doc_del_count);
                console.log('PURGING', startBatchIdToPurge, lastBatchIdToPurge);

                for (let i = startBatchIdToPurge; i <= lastBatchIdToPurge; i++) {
                    metadataIdsToFetch.push(`${status.queue[0].collectionId}:${i}`);
                }
            }
            status.queue.shift()
        }
        numFetchesLeft--;
    }

    docs = await fetchDocsForRequestIfEmpty(docs, [], [], metadataIdsToFetch);

    const promises = [];
    for (const queueObj of queueItems) {
        // console.log("QUEUE OBJ", queueObj);
        if (queueObj.purge) {
            const collectionId = queueObj.collectionId;

            for (const key of Object.keys(docs.metadata)) {
                if (key.startsWith(collectionId) && key.split(':')[1] !== 'collection' && Number(key.split(':')[1]) > queueObj.batchId) {
                    docs.metadata[key]._deleted = true;
                }
            }
        }

        const currMetadata = docs.metadata[`${queueObj.collectionId}:${queueObj.batchId}`];
        // console.log("CURR METADATA", currMetadata);
        if (queueObj.uri.startsWith('ipfs://') && currMetadata && currMetadata.uri && currMetadata.uri === queueObj.uri) {
            // console.log("SKIPPING FETCH BECAUSE ALREADY IN IPFS");
            //If we are attempting to fetch the same URI from IPFS, this is redundant (IPFS is permanent storage). Just use the existing metadata.    
            promises.push(Promise.resolve(currMetadata.metadata));
        } else {
            const uriToFetch = queueObj.uri.includes('{id}') && queueObj.badgeIds.length > 0 ? queueObj.uri.replace('{id}', queueObj.badgeIds[0].start.toString()) : queueObj.uri;
            promises.push(fetchUri(uriToFetch));
        }
    }

    const results = await Promise.allSettled(promises);

    for (let i = 0; i < results.length; i++) {
        let queueObj = queueItems[i];
        let result = results[i];
        if (queueObj.uri.includes('{id}') && !queueObj.collection) {
            queueObj.badgeIds = [{ start: queueObj.badgeIds[0].start, end: queueObj.badgeIds[0].start }];
        }

        if (result.status == 'fulfilled') {
            const metadata: BadgeMetadata = result.value;

            docs.metadata[`${queueObj.collectionId}:${queueObj.batchId}`] = {
                metadata: {
                    ...metadata,
                    name: metadata.name || '',
                    description: metadata.description || '',
                    image: metadata.image || '',
                },
                badgeIds: queueObj.badgeIds,
                isCollection: queueObj.collection,
                uri: queueObj.uri,
                id: queueObj.batchId,
                _id: `${queueObj.collectionId}:${queueObj.batchId}`,
                _rev: docs.metadata[`${queueObj.collectionId}:${queueObj.batchId}`]._rev,
                _deleted: false
            };
        } else {
            docs.metadata[`${queueObj.collectionId}:${queueObj.batchId}`] = {
                metadata: { name: '', description: '', image: '' },
                badgeIds: queueObj.badgeIds,
                isCollection: queueObj.collection,
                uri: queueObj.uri,
                id: queueObj.batchId,
                _id: `${queueObj.collectionId}:${queueObj.batchId}`,
                _rev: docs.metadata[`${queueObj.collectionId}:${queueObj.batchId}`]._rev,
                _deleted: false
            }
        }
    }

    return docs;
}