import { FETCHES_DB, METADATA_DB, fetchDocsForCacheIfEmpty } from "./db/db";
import axios from "axios";
import { getFromIpfs } from "./ipfs/ipfs";
import { Collection, DbStatus, DocsCache, Metadata, MetadataDoc } from "bitbadgesjs-utils";
import nano from "nano";

export const fetchUri = async (uri: string): Promise<any> => {
  if (uri.startsWith('ipfs://')) {
    try {
      const doc = await FETCHES_DB.get(uri);
      return doc.file;
    } catch (error) {
      //Not in DB, fetch from IPFS
      const res = await getFromIpfs(uri.replace('ipfs://', ''));
      const ret = JSON.parse(res.file);
      try {
        //We can cache this because it's immutable
        await FETCHES_DB.insert({
          _id: uri,
          file: ret,
          fetchedAt: Date.now()
        });
      } catch (error) { }

      return ret;
    }
  } else {
    const res = await axios.get(uri).then((res) => res.data);
    return res;
  }
}

export const pushToMetadataQueue = async (_collection: Collection, status: DbStatus, specificId?: bigint | 'collection') => {
  const collection: Collection = JSON.parse(JSON.stringify(_collection));
  let currentMetadataId = 0n;

  let pushed = false;
  let alreadyPurging = false;
  //If already in queue somewhere, don't add it again
  const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startMetadataId === currentMetadataId);
  if (!existing) {
    const toPush = !specificId || (specificId && specificId == 'collection');
    if (toPush) {
      status.queue.push({
        uri: collection.collectionUri,
        collectionId: collection.collectionId,
        collection: true,
        badgeIds: [],
        currentMetadataId: 0n,
        numCalls: 0n,
        startMetadataId: currentMetadataId,
      });
      pushed = true;
    }
  } else if (existing.purge) {
    alreadyPurging = true;
  }
  currentMetadataId++;

  for (const badgeUri of collection.badgeUris) {
    if (badgeUri.uri.includes('{id}')) {
      for (const badgeIdRange of badgeUri.badgeIds) {
        const toPush = !specificId || (specificId && specificId !== 'collection' && specificId >= badgeIdRange.start && specificId <= badgeIdRange.end);
        const specificIdToAdd = toPush && specificId ? specificId : undefined;
        const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startMetadataId === currentMetadataId && q.specificId === specificIdToAdd);
        if (!existing) {
          if (toPush) {
            status.queue.push({
              uri: badgeUri.uri,
              collectionId: collection.collectionId,
              collection: false,
              badgeIds: [badgeIdRange],
              currentMetadataId: currentMetadataId,
              startMetadataId: currentMetadataId,
              numCalls: 0n,
              specificId: specificIdToAdd,
            });
            pushed = true;
          }
        } else if (existing.purge) {
          alreadyPurging = true;
        }
        currentMetadataId += badgeIdRange.end - badgeIdRange.start + 1n;
      }
    } else {
      const toPush = !specificId || (specificId && specificId !== 'collection' && badgeUri.badgeIds.find((id) => id.start <= specificId && id.end >= specificId));
      const specificIdToAdd = toPush && specificId ? specificId : undefined;
      const existing = status.queue.find((q) => q.collectionId === collection.collectionId && q.startMetadataId === currentMetadataId && q.specificId === specificIdToAdd);
      if (!existing) {
        if (toPush) {
          status.queue.push({
            uri: badgeUri.uri,
            collectionId: collection.collectionId,
            collection: false,
            badgeIds: badgeUri.badgeIds,
            currentMetadataId: currentMetadataId,
            numCalls: 0n,
            specificId: toPush && specificId ? specificId : undefined,
            startMetadataId: currentMetadataId,
          });
          pushed = true;
        }
      } else {
        if (existing.purge) {
          alreadyPurging = true;
        }
      }
      currentMetadataId++;
    }
  }

  if (pushed && !specificId && !alreadyPurging) {
    status.queue[status.queue.length - 1].purge = true;
  }
}

//Assumes the metadata queue mutex is already obtained
export const fetchUriInQueue = async (status: DbStatus, docs: DocsCache) => {
  const NUM_METADATA_FETCHES_PER_BLOCK = 25;
  const MAX_NUM_CALLS_PER_URI = 1000;

  //TODO: we have redundances with addMetadataToIpfs (we cache it in FETCHES_DB but we store it again in METADATA_DB)

  let numFetchesLeft = NUM_METADATA_FETCHES_PER_BLOCK;
  let metadataIdsToFetch: string[] = [];

  const queueItems = [];
  while (numFetchesLeft > 0 && status.queue.length > 0) {
    //Handle if we are only fetching a specific badgeID
    if (status.queue[0].specificId && status.queue[0].currentMetadataId !== 'collection') {
      const matchingIdRange = status.queue[0].badgeIds.find((id) => {
        if (status.queue[0].specificId) return id.start <= status.queue[0].specificId && id.end >= status.queue[0].specificId

        return false;
      });

      if (matchingIdRange) status.queue[0].currentMetadataId += status.queue[0].specificId - matchingIdRange.start;
      status.queue[0].badgeIds = [{ start: status.queue[0].specificId, end: status.queue[0].specificId }];
    }

    metadataIdsToFetch.push(`${status.queue[0].collectionId}:${status.queue[0].currentMetadataId}`);
    const queueItem = status.queue[0];

    if (queueItem) queueItems.push(JSON.parse(JSON.stringify(queueItem)));

    if (queueItem.uri.includes('{id}') && !queueItem.collection) {
      status.queue[0].numCalls++;

      //Should only be one badgeId[]
      status.queue[0].badgeIds.forEach((badgeIdRange) => {
        badgeIdRange.start++;
      });
      if (status.queue[0].currentMetadataId !== 'collection') status.queue[0].currentMetadataId++;

      //If we have reached the end of the range, remove it from the queue
      if (status.queue[0].badgeIds[0].start > status.queue[0].badgeIds[0].end) {
        //Fetch and purge all entries for this collection
        if (status.queue[0].purge) {
          // const res = await METADATA_DB.partitionedList(`${status.queue[0].collectionId}`);
          const info = await METADATA_DB.partitionInfo(`${status.queue[0].collectionId}`);

          const lastBatchIdToPurge = info.doc_count + info.doc_del_count - 1;
          const startBatchIdToPurge = status.queue[0].currentMetadataId !== 'collection' ? status.queue[0].currentMetadataId : 1;

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

        const lastBatchIdToPurge = info.doc_count + info.doc_del_count - 1;
        const startBatchIdToPurge = status.queue[0].currentMetadataId !== 'collection' ? status.queue[0].currentMetadataId + 1n : 1;

        for (let i = startBatchIdToPurge; i <= lastBatchIdToPurge; i++) {
          metadataIdsToFetch.push(`${status.queue[0].collectionId}:${i}`);
        }
      }
      status.queue.shift()
    }
    numFetchesLeft--;
  }

  await fetchDocsForCacheIfEmpty(docs, [], [], metadataIdsToFetch, [], []);

  const promises = [];
  for (const queueObj of queueItems) {
    if (queueObj.purge) {
      const collectionId = queueObj.collectionId;

      //This is a little hack. We set every document in the collection to be deleted, and then we will set to non-deleted the ones we want to keep.
      for (const key of Object.keys(docs.metadata)) {
        if (key.startsWith(collectionId) && key.split(':')[1] !== 'collection' && BigInt(key.split(':')[1]) > queueObj.currentMetadataId) {
          //HACK: We cast here. Even if the document is not populated, we can still set the _deleted flag.
          const doc = docs.metadata[key] as MetadataDoc & nano.DocumentGetResponse;
          doc._deleted = true;
        }
      }
    }

    //HACK: This is not a safe cast, but it is only used within the first if statement.
    //If it is still an unpopulated document (i.e. { _id: string }, then it will never enter the first if statement
    const currMetadata = docs.metadata[`${queueObj.collectionId}:${queueObj.currentMetadataId}`] as MetadataDoc & nano.DocumentGetResponse;

    if (queueObj.uri.startsWith('ipfs://') && currMetadata && currMetadata.uri && currMetadata.uri === queueObj.uri) {
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
      const metadata: Metadata = result.value;

      docs.metadata[`${queueObj.collectionId}:${queueObj.currentMetadataId}`] = {
        ...docs.metadata[`${queueObj.collectionId}:${queueObj.currentMetadataId}`],
        metadata: {
          ...metadata,
          name: metadata.name || '',
          description: metadata.description || '',
          image: metadata.image || '',
        },
        badgeIds: queueObj.badgeIds,
        isCollection: queueObj.collection,
        uri: queueObj.uri,
        metadataId: queueObj.currentMetadataId,
        _id: `${queueObj.collectionId}:${queueObj.currentMetadataId}`,
        _deleted: false
      };
    } else {
      docs.metadata[`${queueObj.collectionId}:${queueObj.currentMetadataId}`] = {
        ...docs.metadata[`${queueObj.collectionId}:${queueObj.currentMetadataId}`],
        metadata: { name: '', description: '', image: '' },
        badgeIds: queueObj.badgeIds,
        isCollection: queueObj.collection,
        uri: queueObj.uri,
        metadataId: queueObj.currentMetadataId,
        _id: `${queueObj.collectionId}:${queueObj.currentMetadataId}`,
        _deleted: false
      }
    }
  }


}