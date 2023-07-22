import axios from "axios";
import { JSPrimitiveNumberType, MerkleChallenge, convertBalance } from "bitbadgesjs-proto";
import { BigIntify, BitBadgesCollection, CollectionDoc, DocsCache, FetchDoc, Numberify, OffChainBalancesMap, QueueDoc, RefreshDoc, SupportedChain, convertFetchDoc, convertQueueDoc, convertRefreshDoc, getChainForAddress, getMaxMetadataId, getUrisForMetadataIds, isAddressValid, subtractBalances } from "bitbadgesjs-utils";
import nano from "nano";
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from "./db/cache";
import { BALANCES_DB, FETCHES_DB, QUEUE_DB, REFRESHES_DB, insertToDB } from "./db/db";
import { LOAD_BALANCER_ID } from "./indexer";
import { getFromIpfs } from "./ipfs/ipfs";
import { cleanBalances, cleanMerkleChallenges, cleanMetadata } from "./utils/dataCleaners";
import { getLoadBalancerId } from "./utils/loadBalancer";

//1. Upon initial TX (new collection or URIs updating): 
// 	1. Trigger collection, claims, first X badges, and balances in QUEUE_DB
// 	2. Add collection to REFRESHES_DB
// 2. Upon fetch request:
// 	1. Check if URI is to be refreshed in REFRESHES_DB
// 	2. If to be refreshed or not in FETCHES_DB, add to queue. Return adding to queue message or old cached version.
// 	3. Else, return FETCHES_DB cached version
// 	4. If in queue or just added to queue, return flag
// 3. For refresh requests, update REFRESHES_DB
// 	1. Do same as initial TX
// 	2. Refresh queue buffer time - Can't spam. 60 second timeout
// 4. Aggressively prune old QUEUE_DB doc IDs, once _deleted is true. Once deleted, we will never use the doc again.
// 	1. For own node's docs, keep _deleted for much longer for replication purposes (24 hours)
// 	2. For others, we can delete right upon receiving _deleted = true
// 5. When fetching from queue, check if lastFetchedAt > refreshRequestTime (i.e. do not fetch if we have already fetched after latest refresh time)
// 	1. This is fine because we have a no-conflict system for FETCHES_DB
// 	2. Implemented with exponential backoff where delay = 2^numRetries * BASE_DELAY 
// 	3. BASE_DELAY = 12 hours

//Upon fetch request, check in REFRESHES_DB if it is to be refreshed
export const fetchUriFromDb = async (uri: string, collectionId: string) => {
  let fetchDoc: (FetchDoc<JSPrimitiveNumberType> & nano.Document) | undefined;
  let refreshDoc: (RefreshDoc<JSPrimitiveNumberType> & {
    _id: string;
    _rev: string;
  }) | undefined;
  let alreadyInQueue = false;
  let needsRefresh = false;
  let refreshRequestTime = Date.now();

  //Get document from cache if it exists
  try {
    fetchDoc = await FETCHES_DB.get(uri);
  } catch (error) {
    //Throw if non-404 error.
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  //TODO: Get _conflicts and only take the one with latest time
  //Check if we need to refresh
  const refreshesRes = await REFRESHES_DB.find({
    selector: {
      collectionId: {
        "$eq": Number(collectionId),
      }
    },
    limit: 1,
  });

  if (refreshesRes.docs.length > 0) {
    refreshDoc = refreshesRes.docs[0];
    if (!fetchDoc || refreshDoc.refreshRequestTime > fetchDoc.fetchedAt) {
      needsRefresh = true;
      refreshRequestTime = Number(refreshDoc.refreshRequestTime);
    }
  } else {
    throw new Error('Collection refresh document not found');
  }

  /*
    Below, we use a clever approach to prevent multiple queue documents for the same URI and same refresh request.
    This is in case the REFRESHES_DB is ahead of the QUEUE_DB. If REFRESHES_DB is ahead, we do not want
    all N nodes to pick up on the fact that it needs a refresh and create N separate queue documents. Instead, we want
    only one queue document to be created. To do this, we use the _rev of the refresh document as the _id of the queue document.
    This way, the same exact document is created by all N nodes and will not cause any conflicts.
  */

  //Check if already in queue
  const res = await QUEUE_DB.get(`${uri}-${refreshDoc._rev}`).catch((e) => {
    if (e.statusCode !== 404) {
      throw e;
    }
    return undefined;
  });

  if (res) {
    alreadyInQueue = true;
  }

  //If not already in queue and we need to refresh, add to queue
  if (!alreadyInQueue && needsRefresh) {

    const loadBalanceId = getLoadBalancerId(`${uri}-${refreshDoc._rev}`); //`${uri}-${refreshDoc._rev}

    await insertToDB(QUEUE_DB, {
      _id: `${uri}-${refreshDoc._rev}`,
      _rev: undefined,
      uri: uri,
      collectionId: collectionId,
      refreshRequestTime,
      numRetries: 0,
      loadBalanceId,
    });
  }

  return {
    content: fetchDoc ? fetchDoc.content : undefined,
    updating: alreadyInQueue || needsRefresh,
  };
}

export const fetchUriFromSourceAndUpdateDb = async (uri: string, queueObj: QueueDoc<bigint>) => {
  let fetchDoc: (FetchDoc<bigint> & nano.IdentifiedDocument & nano.MaybeRevisionedDocument) | undefined;
  let needsRefresh = false;
  let dbType: 'MerkleChallenge' | 'Metadata' | 'Balances' = 'Metadata';

  //Get document from cache if it exists
  try {
    const _fetchDoc = await FETCHES_DB.get(uri);
    fetchDoc = convertFetchDoc(_fetchDoc, BigIntify);
  } catch (error) {
    //Throw if non-404 error.
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  //If permanent, do not need to fetch from source
  if (fetchDoc && fetchDoc.isPermanent) {
    await insertToDB(FETCHES_DB, {
      ...fetchDoc,
      fetchedAt: BigInt(Date.now()),
    });
    return;
  }

  //Check if we need to refresh
  if (!fetchDoc || queueObj.refreshRequestTime > fetchDoc.fetchedAt) {
    needsRefresh = true;
  }

  //Fetch from URI and update cache
  if (needsRefresh) {
    let res: any;
    let isPermanent = false;
    //If we are here, we need to fetch from the source
    if (uri.startsWith('ipfs://')) {
      const _res = await getFromIpfs(uri.replace('ipfs://', ''));
      res = JSON.parse(_res.file);
      isPermanent = true;
    } else {
      const _res = await axios.get(uri).then((res) => res.data);
      res = JSON.parse(_res);
    }

    if (res.image) { //res.image is required for all metadata and not included in any other type
      dbType = 'Metadata';
      res = cleanMetadata(res);
    } else if (res.hasPassword) { //hasPassword is required for all claims and not included in any other type
      dbType = 'MerkleChallenge';
      res = cleanMerkleChallenges(res);
    } else if (Object.keys(res).every((key) => isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS)) { //If it has at least one valid address as a key, it is a balances doc
      dbType = 'Balances';
      res = cleanBalances(res);
      await handleBalances(res, queueObj);
    } else {
      throw new Error('Invalid content. Must be metadata, claim, or balances.');
    }

    await insertToDB(FETCHES_DB, {
      ...fetchDoc,
      _id: uri,
      _rev: undefined,
      content: dbType !== 'Balances' ? res : undefined, //We already stored balances in a separate DB so it makes no sense to doubly store content here
      fetchedAt: BigInt(Date.now()),
      db: dbType,
      isPermanent
    });
  }
}

const MIN_TIME_BETWEEN_REFRESHES = process.env.MIN_TIME_BETWEEN_REFRESHES ? BigInt(process.env.MIN_TIME_BETWEEN_REFRESHES) : BigInt(1000 * 60); //1 minute
export const updateRefreshDoc = async (docs: DocsCache, collectionId: string, refreshRequestTime: bigint) => {

  const _refreshesRes = await REFRESHES_DB.get(collectionId);
  const refreshesRes = convertRefreshDoc(_refreshesRes, BigIntify);

  if (refreshesRes.refreshRequestTime + MIN_TIME_BETWEEN_REFRESHES > Date.now()) {
    //If we have refreshed recently, do not spam it
    return true;
  }

  docs.refreshes[collectionId] = {
    ...refreshesRes,
    refreshRequestTime,
  };

  return false
}


export const getMerkleChallengeIdForQueueDb = (entropy: string, collectionId: string, claimId: string) => {
  return entropy + "-claim-" + collectionId.toString() + "-" + claimId.toString()
}

export const pushMerkleChallengeFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, claim: MerkleChallenge<bigint>, loadBalanceId: number, refreshTime: bigint, deterministicEntropy?: string) => {
  docs.queueDocsToAdd.push({
    _id: deterministicEntropy ? getMerkleChallengeIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), claim.uri.toString()) : undefined,
    uri: claim.uri,
    collectionId: BigInt(collection.collectionId),
    numRetries: 0n,
    refreshRequestTime: refreshTime,
    loadBalanceId: BigInt(loadBalanceId)
  })
}

export const getCollectionIdForQueueDb = (entropy: string, collectionId: string, timelineTimeStart: string, metadataId?: string) => {
  return entropy + "-collection-" + collectionId.toString() + "-" + timelineTimeStart + (metadataId ? "-" + metadataId : '')
}

const NUM_BADGE_METADATAS_FECTHED_ON_EVENT = 10000;
export const pushCollectionFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, refreshTime: bigint, deterministicEntropy?: string) => {
  //TODO: only future values

  const uris = collection.collectionMetadataTimeline.map(x => x.collectionMetadata.uri);
  const nonDuplicates = [...new Set(uris)];


  for (const uri of nonDuplicates) {
    const loadBalanceId = deterministicEntropy ? getLoadBalancerId(getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), collection.collectionMetadataTimeline.find(x => x.collectionMetadata.uri === uri)?.timelineTimes[0].start.toString() ?? "")) : 0;
    docs.queueDocsToAdd.push({
      _id: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), collection.collectionMetadataTimeline.find(x => x.collectionMetadata.uri === uri)?.timelineTimes[0].start.toString() ?? "") : undefined,
      uri: uri,
      collectionId: BigInt(collection.collectionId),
      numRetries: 0n,
      refreshRequestTime: refreshTime,
      loadBalanceId: BigInt(loadBalanceId)
    });
  }

  //TODO: Should probably restrict NUM_BADGE_METADATAS_FECTHED_ON_EVENT based on how many loops, not x10000 each time
  for (const timelineVal of collection.badgeMetadataTimeline) {
    const badgeMetadata = timelineVal.badgeMetadata;

    const maxMetadataId = getMaxMetadataId(badgeMetadata);
    const maxIdx = maxMetadataId < NUM_BADGE_METADATAS_FECTHED_ON_EVENT ? maxMetadataId : NUM_BADGE_METADATAS_FECTHED_ON_EVENT;

    for (let i = 1; i <= maxIdx; i++) {
      const uris = getUrisForMetadataIds([BigInt(i)], "", badgeMetadata); //Can be "" bc metadataId is never 0
      const uri = uris[0];
      if (uri) {
        const loadBalanceId = deterministicEntropy ? getLoadBalancerId(getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "", `${i}`)) : 0;
        docs.queueDocsToAdd.push({
          _id: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "", `${i}`) : undefined,
          uri: uri,
          collectionId: collection.collectionId,
          numRetries: 0n,
          refreshRequestTime: refreshTime,
          loadBalanceId: BigInt(loadBalanceId)
        })
      }
    }
  }
}

export const getBalancesIdForQueueDb = (entropy: string, collectionId: string, timelineTime: string) => {
  return entropy + "-balances-" + collectionId.toString() + "-" + timelineTime
}

export const pushBalancesFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, refreshTime: bigint, deterministicEntropy?: string) => {


  let uriToFetch = '';
  for (const timelineVal of collection.offChainBalancesMetadataTimeline) {
    if (!uriToFetch) uriToFetch = timelineVal.offChainBalancesMetadata.uri;

    const offChainBalancesMetadata = timelineVal.offChainBalancesMetadata;
    const docId = deterministicEntropy ? getBalancesIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "") : undefined;
    const loadBalanceId = getLoadBalancerId(docId ?? "");
    docs.queueDocsToAdd.push({
      _id: docId,
      uri: offChainBalancesMetadata.uri,
      collectionId: collection.collectionId,
      refreshRequestTime: refreshTime,
      numRetries: 0n,
      loadBalanceId: BigInt(loadBalanceId)
    })

    //TODO: Support pre-loading future values (i.e. if we know the balancesUri for the next collection, we can preload it). We currently only take first.
    //      But, note that they can currently just specify the ownership times within the balances, so there really is no need to have multiple here
    break;
  }
}

const handleBalances = async (balancesMap: OffChainBalancesMap<bigint>, queueObj: QueueDoc<bigint>) => {
  //TODO: This overwrites everything each time

  const docs: DocsCache = {
    accounts: {},
    collections: {},
    balances: {},
    refreshes: {},
    merkleChallenges: {},
    approvalsTrackers: {},
    addressMappings: {},
    activityToAdd: [],
    queueDocsToAdd: [],
  };

  const totalSupplysDoc = await BALANCES_DB.get(`${queueObj.collectionId}:Total`);
  let remainingSupplys = totalSupplysDoc.balances.map(x => convertBalance(x, BigIntify));

  //Handle balance doc creation
  let balanceMap = balancesMap;
  //We have to update the existing balances with the new balances, if the collection already exists
  //This is a complete overwrite of the balances (i.e. we fetch all the balances from the balancesUri and overwrite the existing balances
  await fetchDocsForCacheIfEmpty(docs, [], [], [
    ...Object.keys(balanceMap).filter(key => isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS).map((key) => `${queueObj.collectionId}:${key}`),
  ], [], [], []);

  //Update the balance documents
  for (const [key, val] of Object.entries(balanceMap)) {
    if (isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS) {


      docs.balances[`${queueObj.collectionId}:${key}`] = {
        _rev: docs.balances[`${queueObj.collectionId}:${key}`]?._rev || '',
        _id: `${queueObj.collectionId}:${key}`,
        balances: val,
        //Off-Chain Balances so we don't care ab approvals or permissions
        approvedIncomingTransfersTimeline: [],
        approvedOutgoingTransfersTimeline: [],
        userPermissions: {
          canUpdateApprovedIncomingTransfers: [],
          canUpdateApprovedOutgoingTransfers: [],
        },
        collectionId: queueObj.collectionId,
        cosmosAddress: key,
        fetchedAt: BigInt(Date.now()),
        onChain: false,
        uri: queueObj.uri,
        isPermanent: queueObj.uri.startsWith('ipfs://')
      };

      //Will throw if underflow and the URI speecifies more badges than what is denoted on the blockchain
      //This is to enforce that the balancesUri is not lying or overallocating balances 
      for (const balance of val) {
        remainingSupplys = subtractBalances([{
          badgeIds: balance.badgeIds,
          amount: balance.amount,
          ownedTimes: balance.ownedTimes
        }], remainingSupplys);
      }
    }
  }

  //TODO: Eventually, we should make this a transactional all-or-nothing update with QUEUE_DB.destroy
  await flushCachedDocs(docs);
}

export const fetchUrisFromQueue = async () => {
  //To prevent spam and bloated metadata, we set the following parameters.
  //If we cannot fetch within the parameters, it will remain in the queue and will be fetched again.
  const NUM_METADATA_FETCHES_PER_BLOCK = process.env.NUM_METADATA_FETCHES_PER_BLOCK ? Number(process.env.NUM_METADATA_FETCHES_PER_BLOCK) : 25;
  const BASE_DELAY = process.env.BASE_DELAY ? Number(process.env.BASE_DELAY) : 1000 * 60 * 60 * 1; //1 hour

  let numFetchesLeft = NUM_METADATA_FETCHES_PER_BLOCK;

  const queueRes = await QUEUE_DB.find({
    selector: {
      _id: { $gt: null },
      loadBalanceId: {
        "$eq": LOAD_BALANCER_ID
      }
    },
    limit: NUM_METADATA_FETCHES_PER_BLOCK
  });

  const queue = queueRes.docs.map((doc) => convertQueueDoc(doc, BigIntify));
  const queueItems: (QueueDoc<bigint> & nano.DocumentGetResponse)[] = [];

  while (numFetchesLeft > 0 && queue.length > 0) {
    const currQueueDoc = queue[0];
    if (currQueueDoc) {
      const delay = BASE_DELAY * Math.pow(2, Number(currQueueDoc.numRetries));

      //This uses exponential backoff to prevent spamming the source
      //Delay = BASE_DELAY * 2^numRetries
      if (currQueueDoc.lastFetchedAt && Number(currQueueDoc.lastFetchedAt) + delay > Date.now()) {
        //If we have fetched this URI recently, do not spam it
      } else {
        queueItems.push(convertQueueDoc(currQueueDoc, BigIntify) as any); //Used for a deep copy
      }
    }
    queue.shift()
    numFetchesLeft--;
  }

  const promises = [];
  for (const queueObj of queueItems) {
    promises.push(fetchUriFromSourceAndUpdateDb(queueObj.uri, queueObj));
  }

  //If fulfilled, delete from queue (after creating balance docs if necessary).
  //If rejected, do nothing (it will remain in queue)
  const results = await Promise.allSettled(promises);
  for (let i = 0; i < results.length; i++) {
    let queueObj = queueItems[i];
    let result = results[i];

    if (result.status == 'fulfilled') {
      try {
        await insertToDB(QUEUE_DB, {
          ...queueObj,
          _deleted: true,
          deletedAt: BigInt(Date.now()),
        });
      } catch (e) {
        console.error(e);
      }
    } else {
      let reason = '';
      try {
        reason = result.reason.toString();
      } catch (e) {
        try {
          reason = JSON.stringify(result.reason);
        } catch (e) {
          reason = 'Could not stringify error message';
        }
      }

      await insertToDB(QUEUE_DB, {
        ...queueObj,
        lastFetchedAt: BigInt(Date.now()),
        error: reason,
        numRetries: BigInt(queueObj.numRetries + 1n),
      });

      console.error(result.reason);
    }
  }
}

export const purgeQueueDocs = async () => {
  const res = await QUEUE_DB.find({
    selector: {
      _deleted: {
        "$eq": true
      }
    },
  });
  const docs = res.docs.map((doc) => convertQueueDoc(doc, Numberify));

  let docsToPurge = {};
  for (const doc of docs) {
    //Purge all deleted docs from this load balancer that are older than 24 hours
    //Keep for 24 hours for replication purposes
    if (doc.loadBalanceId === LOAD_BALANCER_ID) {
      if (doc.deletedAt && doc.deletedAt + 1000 * 60 * 60 * 24 < Date.now()) {
        docsToPurge[doc._id] = doc._rev;
      }
    } else {
      //Purge all deleted docs that are not from the current load balancer
      docsToPurge[doc._id] = doc._rev;
    }
  }

  await axios.post(process.env.DB_URL + '/queue/_purge', docsToPurge);
}
