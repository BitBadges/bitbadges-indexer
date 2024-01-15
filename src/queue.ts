import axios from "axios";
import { AddressList, JSPrimitiveNumberType, NumberType, convertBalance, deepCopy } from "bitbadgesjs-proto";
import { BigIntify, BitBadgesCollection, CollectionDoc, DocsCache, FetchDoc, OffChainBalancesMap, QueueDoc, RefreshDoc, SupportedChain, TransferActivityDoc, convertBalanceDoc, convertFetchDoc, convertOffChainBalancesMap, convertQueueDoc, convertRefreshDoc, convertToCosmosAddress, getChainForAddress, getCurrentIdxForTimeline, getMaxMetadataId, getUrisForMetadataIds, isAddressValid, subtractBalances } from "bitbadgesjs-utils";
import crypto from 'crypto';
import CryptoJS from "crypto-js";
import Joi from "joi";
import mongoose from "mongoose";
import nano from "nano";
import { serializeError } from "serialize-error";
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from "./db/cache";
import { BalanceModel, ErrorModel, FetchModel, QueueModel, RefreshModel, deleteMany, getFromDB, getManyFromDB, insertToDB, mustGetFromDB } from "./db/db";
import { LOAD_BALANCER_ID, TIME_MODE } from "./indexer-vars";
import { getFromIpfs } from "./ipfs/ipfs";
import { QUEUE_TIME_MODE, sendPushNotification } from "./poll";
import { getAddressListsFromDB } from "./routes/utils";
import { compareObjects } from "./utils/compare";
import { cleanApprovalInfo, cleanBalanceMap, cleanMetadata } from "./utils/dataCleaners";
import { getLoadBalancerId } from "./utils/loadBalancer";

const { SHA256 } = CryptoJS

//1. Upon initial TX (new collection or URIs updating): 
// 	1. Trigger collection, claims, first X badges, and balances to queue in QueueModel
// 	2. Add collection to RefreshModel
// 2. Upon fetch request:
// 	1. Check if URI is to be refreshed in RefreshModel
// 	2. If to be refreshed or not in FetchModel, add to queue. Return adding to queue message or old cached version.
// 	3. Else, return FetchModel cached version
// 	4. If in queue or just added to queue, return flag
// 3. For refresh requests, update RefreshModel
// 	1. Do same as initial TX
// 	2. Refresh queue buffer time - Can't spam. 60 second timeout
// 4. Aggressively prune old QueueModel doc IDs, once _deleted is true. Once deleted, we will never use the doc again.
// 	1. For own node's docs, keep _deleted for much longer for replication purposes (24 hours)
// 	2. For others, we can delete right upon receiving _deleted = true
// 5. When fetching from queue, check if lastFetchedAt > refreshRequestTime (i.e. do not fetch if we have already fetched after latest refresh time)
// 	1. This is fine because we have a no-conflict system for FetchModel
// 	2. Implemented with exponential backoff where delay = 2^numRetries * BASE_DELAY 
// 	3. BASE_DELAY = 12 hours

//Upon fetch request, check in RefreshModel if it is to be refreshed
export const fetchUrisFromDbAndAddToQueueIfEmpty = async (uris: string[], collectionId: string) => {
  for (const uri of uris) {

    const isValidUri = Joi.string().uri().validate(uri);
    if (isValidUri.error) {
      throw new Error(`Invalid URI: ${uri}`);
    }
  }

  const promises = [];



  //Check if we need to refresh
  const fetchDocPromise = getManyFromDB(FetchModel, uris);
  const refreshDocPromise = mustGetFromDB(RefreshModel, collectionId);

  promises.push(fetchDocPromise);
  promises.push(refreshDocPromise);


  const promiseRes = await Promise.all(promises);

  const toReturn: {
    content?: any,
    updating: boolean,
    fetchedAt: NumberType,
    fetchedAtBlock: NumberType,
    uri: string,
  }[] = [];
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];

    let fetchDoc: (FetchDoc<JSPrimitiveNumberType>) | undefined;
    let refreshDoc: (RefreshDoc<JSPrimitiveNumberType>) | undefined;
    let alreadyInQueue = false;
    let needsRefresh = false;
    let refreshRequestTime = Date.now();

    const fetchDocRes = promiseRes[0] as (FetchDoc<JSPrimitiveNumberType> | undefined)[];

    fetchDoc = fetchDocRes[i] as FetchDoc<JSPrimitiveNumberType>;
    refreshDoc = promiseRes[1] as RefreshDoc<JSPrimitiveNumberType>;



    if (!fetchDoc || refreshDoc.refreshRequestTime > fetchDoc.fetchedAt) {
      needsRefresh = true;
      refreshRequestTime = Number(refreshDoc.refreshRequestTime);
    }


    /*
      Below, we use a clever approach to prevent multiple queue documents for the same URI and same refresh request.
      This is in case the RefreshModel is ahead of the QueueModel. If RefreshModel is ahead, we do not want
      all N nodes to pick up on the fact that it needs a refresh and create N separate queue documents. Instead, we want
      only one queue document to be created. To do this, we use the refreshRequestTime of the refresh document as the _docId of the queue document.
      This way, the same exact document is created by all N nodes and will not cause any conflicts.
    */

    //If not already in queue and we need to refresh, add to queue
    if (needsRefresh) {
      const id = `${uri}-${refreshDoc.refreshRequestTime}`;
      //Check if already in queue
      const res = await getFromDB(QueueModel, id);
      if (res) {
        alreadyInQueue = true;
      }

      if (!alreadyInQueue) {
        const loadBalanceId = getLoadBalancerId(`${uri}-${refreshDoc.refreshRequestTime}`); //`${uri}-${refreshDoc.refreshRequestTime}

        await insertToDB(QueueModel, {
          _docId: `${uri}-${refreshDoc.refreshRequestTime}`,
          uri: uri,
          collectionId: collectionId,
          refreshRequestTime,
          numRetries: 0,
          loadBalanceId,
          nextFetchTime: BigInt(Date.now(),)
        });
      }
    }

    toReturn.push({
      content: fetchDoc ? fetchDoc.content : undefined,
      updating: alreadyInQueue || needsRefresh,
      fetchedAt: fetchDoc ? fetchDoc.fetchedAt : 0n,
      fetchedAtBlock: fetchDoc ? fetchDoc.fetchedAtBlock : 0n,
      uri: uri,
    });
  }

  return toReturn;
}

export const fetchUriFromSource = async (uri: string) => {
  let res: any;
  //If we are here, we need to fetch from the source
  if (uri.startsWith('ipfs://')) {

    const _res: any = await getFromIpfs(uri.replace('ipfs://', ''));

    res = JSON.parse(_res.file);
  } else {

    const ownDigitalOceanSpaces = uri.startsWith('https://bitbadges-balances.nyc3.digitaloceanspaces.com');
    const options = ownDigitalOceanSpaces ? {
      headers: {
        'Cache-Control': 'no-cache',
      }
    } : undefined;

    const _res = await axios.get(uri, options).then((res) => res.data);
    res = _res;
  }

  return res;
}

export const fetchUriFromSourceAndUpdateDb = async (uri: string, queueObj: QueueDoc<bigint>, block: bigint) => {
  let fetchDoc: (FetchDoc<bigint>) | undefined;
  let needsRefresh = false;
  let dbType: 'ApprovalInfo' | 'Metadata' | 'Balances' = 'Metadata';

  if (uri == "https://api.bitbadges.io/api/v0/ethFirstTx/{address}") {
    //Hardcoded to be handled by the fetch balances API function
    return;
  }


  //Get document from cache if it exists
  const _fetchDoc = await getFromDB(FetchModel, uri);
  fetchDoc = _fetchDoc ? convertFetchDoc(_fetchDoc, BigIntify) : undefined;


  //If permanent, do not need to fetch from source
  if (fetchDoc && fetchDoc.isPermanent) {
    await insertToDB(FetchModel, {
      ...fetchDoc,
      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: block
    });

    //If it is a balances document, we call handleBalances to update the fetchedAt and fetchedAtBlock fields.
    //However, this function will recognize that the balances are the same and not update all the balances docs 
    //We just update and only use the fetchedAt for Mint and Total
    //This is to prevent 10000+ or however many writes just to update the fetchedAt
    if (fetchDoc.db === 'Balances') {
      await handleBalances(fetchDoc.content as OffChainBalancesMap<bigint>, queueObj, block);
    }
    return;
  }

  //Check if we need to refresh
  if (!fetchDoc || queueObj.refreshRequestTime > fetchDoc.fetchedAt) {
    needsRefresh = true;
  }

  //Fetch from URI and update cache
  if (needsRefresh) {
    const isPermanent = uri.startsWith('ipfs://');

    let res = await fetchUriFromSource(uri);


    //Handle different types of docs
    if (res.image || res.video) { //res.image is required for all metadata and not included in any other type
      dbType = 'Metadata';
      res = cleanMetadata(res);
    } else if (Object.values(res).some(x => Array.isArray(x)) || Object.keys(res).length == 0) {
      dbType = 'Balances';
      res = cleanBalanceMap(res);
      res = convertOffChainBalancesMap(res, BigIntify);

      //Compare res and fetchDoc.content and only update trigger balances writes if they are different. Else, just update fetchedAt
      await handleBalances(res, queueObj, block);
    } else {
      dbType = 'ApprovalInfo';
      res = cleanApprovalInfo(res);
    }

    await insertToDB(FetchModel, {
      ...fetchDoc,

      _docId: uri,
      content: res,
      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: block,
      db: dbType,
      isPermanent,
    });
  }
}

const MIN_TIME_BETWEEN_REFRESHES = process.env.MIN_TIME_BETWEEN_REFRESHES ? BigInt(process.env.MIN_TIME_BETWEEN_REFRESHES) : BigInt(1000 * 60 * 5); //5 minutes
export const updateRefreshDoc = async (docs: DocsCache, collectionId: string, refreshRequestTime: bigint, forceful?: boolean) => {

  const _refreshesRes = await mustGetFromDB(RefreshModel, collectionId);
  const refreshesRes = convertRefreshDoc(_refreshesRes, BigIntify);

  if (!forceful && refreshesRes.refreshRequestTime + MIN_TIME_BETWEEN_REFRESHES > Date.now()) {
    //If we have refreshed recently, do not spam it
    return refreshesRes.refreshRequestTime + MIN_TIME_BETWEEN_REFRESHES - BigInt(Date.now());
  }

  docs.refreshes[collectionId] = {
    ...refreshesRes,
    refreshRequestTime,
  };

  return 0
}


export const getApprovalInfoIdForQueueDb = (entropy: string, collectionId: string, claimId: string) => {
  return entropy + "-approval-" + collectionId.toString() + "-" + claimId.toString()
}

export const pushApprovalInfoFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, uri: string, loadBalanceId: number, refreshTime: bigint, deterministicEntropy?: string) => {
  docs.queueDocsToAdd.push({
    _docId: deterministicEntropy ? getApprovalInfoIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), uri.toString()) : crypto.randomBytes(16).toString('hex'),
    uri: uri,
    collectionId: BigInt(collection.collectionId),
    numRetries: 0n,
    refreshRequestTime: refreshTime,
    loadBalanceId: BigInt(loadBalanceId),
    nextFetchTime: BigInt(Date.now()),
  })
}

export const getCollectionIdForQueueDb = (entropy: string, collectionId: string, timelineTimeStart: string, metadataId?: string) => {
  return entropy + "-collection-" + collectionId.toString() + "-" + timelineTimeStart + (metadataId ? "-" + metadataId : '')
}

const NUM_BADGE_METADATAS_FETCHED_ON_EVENT = 10000;
const MAX_FETCHES_ALLOWED = 10000 * 3; //Sanity check to prevent too many fetches from being added to the queue

export const pushCollectionFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, refreshTime: bigint, deterministicEntropy?: string) => {
  const uris = collection.collectionMetadataTimeline.map(x => x.collectionMetadata.uri);
  const nonDuplicates = [...new Set(uris)];
  let totalQueueDocs = nonDuplicates.length;
  if (totalQueueDocs > MAX_FETCHES_ALLOWED) {
    throw new Error(`Too many fetches added to refresh queue for collection ${collection.collectionId}. Max allowed is ${MAX_FETCHES_ALLOWED}.`);
  }

  for (const uri of nonDuplicates) {
    const loadBalanceId = deterministicEntropy ? getLoadBalancerId(getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), collection.collectionMetadataTimeline.find(x => x.collectionMetadata.uri === uri)?.timelineTimes[0].start.toString() ?? "")) : 0;
    docs.queueDocsToAdd.push({
      _docId: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), collection.collectionMetadataTimeline.find(x => x.collectionMetadata.uri === uri)?.timelineTimes[0].start.toString() ?? "") : crypto.randomBytes(16).toString('hex'),
      uri: uri,
      collectionId: BigInt(collection.collectionId),
      numRetries: 0n,
      refreshRequestTime: refreshTime,
      loadBalanceId: BigInt(loadBalanceId),
      nextFetchTime: BigInt(Date.now(),)
    });
  }

  let numFetches = 0;
  for (const timelineVal of collection.badgeMetadataTimeline) {
    const badgeMetadata = timelineVal.badgeMetadata;

    const maxMetadataId = getMaxMetadataId(badgeMetadata);
    const maxIdx = maxMetadataId < NUM_BADGE_METADATAS_FETCHED_ON_EVENT ? maxMetadataId : NUM_BADGE_METADATAS_FETCHED_ON_EVENT;
    numFetches += Number(maxIdx);
  }

  //Here, upon collection creation, we try to fetch the first N metadata URIs (e.g. the first 10000 badges' metadata). 
  //This is just to preload and ingest some metadata automatically into the system. For larger collections where metadata
  //is not handled by this initial preload, we will fetch on demand later.

  //If we are fetching more than MAX_FETCHES_ALLOWED, we need to limit the number of fetches per timeline value.
  //Should only occur in extreme cases with very large collections. 
  //This isn't the best solution bc a timeline w/ len == 2 could have, for example, 1 and 10000000 metadataIds, 
  //and this would fetch 1 + NUM_BADGE_METADATAS_FETCHED_ON_EVENT but most optimal would be 2 * NUM_BADGE_METADATAS_FETCHED_ON_EVENT 
  let MAX_NUM_PER_TIMELINE = NUM_BADGE_METADATAS_FETCHED_ON_EVENT;
  if (numFetches > MAX_FETCHES_ALLOWED) {
    MAX_NUM_PER_TIMELINE = Math.floor(MAX_FETCHES_ALLOWED / collection.badgeMetadataTimeline.length);
  }

  for (const timelineVal of collection.badgeMetadataTimeline) {
    const badgeMetadata = timelineVal.badgeMetadata;

    const maxMetadataId = getMaxMetadataId(badgeMetadata);
    const maxIdx = maxMetadataId < MAX_NUM_PER_TIMELINE ? maxMetadataId : MAX_NUM_PER_TIMELINE;

    for (let i = 1; i <= maxIdx; i++) {
      const uris = getUrisForMetadataIds([BigInt(i)], "", badgeMetadata); //Can be "" bc metadataId is never 0
      const uri = uris[0];
      if (uri) {
        const loadBalanceId = deterministicEntropy ? getLoadBalancerId(getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "", `${i}`)) : 0;
        docs.queueDocsToAdd.push({
          _docId: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "", `${i}`) : crypto.randomBytes(16).toString('hex'),
          uri: uri,
          collectionId: collection.collectionId,
          numRetries: 0n,
          refreshRequestTime: refreshTime,
          loadBalanceId: BigInt(loadBalanceId),

          nextFetchTime: BigInt(Date.now(),
          )
        })
      }
    }
  }
}

export const getAddressListIdForQueueDb = (entropy: string, listId: string) => {
  return entropy + "-addressList-" + listId.toString()
}

export const pushAddressListFetchToQueue = async (docs: DocsCache, list: AddressList, refreshTime: bigint, deterministicEntropy?: string) => {
  docs.queueDocsToAdd.push({
    _docId: deterministicEntropy ? getAddressListIdForQueueDb(deterministicEntropy, list.listId) : crypto.randomBytes(16).toString('hex'),
    uri: list.uri,
    numRetries: 0n,
    collectionId: 0n,
    refreshRequestTime: refreshTime,
    loadBalanceId: BigInt(getLoadBalancerId(deterministicEntropy ?? "")),
    nextFetchTime: BigInt(Date.now()),
  })
}


export const getBalancesIdForQueueDb = (entropy: string, collectionId: string, timelineTime: string) => {
  return entropy + "-balances-" + collectionId.toString() + "-" + timelineTime
}

export const pushBalancesFetchToQueue = async (docs: DocsCache, collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, refreshTime: bigint, deterministicEntropy?: string) => {
  let uriToFetch = '';
  if (collection.offChainBalancesMetadataTimeline.length == 0) {
    return;
  }

  //We currently only fetch the balances URI for the current time or (if it doesn't exist) the first time
  //This is because BalanceModel is a complete overwrite of the balances, so we don't want to overwrite the balances with the wrong balances
  //Also note that there is no need to specify >1 timeline values because they can just do so with ownership times
  let idx = getCurrentIdxForTimeline(collection.offChainBalancesMetadataTimeline);
  idx = idx == -1 ? 0 : idx;
  const timelineVal = collection.offChainBalancesMetadataTimeline[Number(idx)];
  if (!uriToFetch) uriToFetch = timelineVal.offChainBalancesMetadata.uri;

  const offChainBalancesMetadata = timelineVal.offChainBalancesMetadata;
  const docId = deterministicEntropy ? getBalancesIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "") : new mongoose.Types.ObjectId().toString();
  const loadBalanceId = getLoadBalancerId(docId ?? "");
  docs.queueDocsToAdd.push({
    _docId: docId,
    uri: offChainBalancesMetadata.uri,
    collectionId: collection.collectionId,
    refreshRequestTime: refreshTime,
    numRetries: 0n,
    loadBalanceId: BigInt(loadBalanceId),

    nextFetchTime: BigInt(Date.now()),
  })
}


const MAX_NUM_ADDRESSES = 15000;

export const handleBalances = async (balanceMap: OffChainBalancesMap<bigint>, queueObj: QueueDoc<bigint>, block: bigint) => {
  const balanceMapHash = SHA256(JSON.stringify(balanceMap)).toString();

  if (TIME_MODE && QUEUE_TIME_MODE) console.time('handleBalances');
  //Pretty much, this function is responsible for updating the balances docs in BalanceModel for off-chain balance JSONs 
  //This is to make them compatible with our existing on-chain balances docs in BalanceModel
  //We treat it as at the beginning of this function, "Mint" holds all the balances (i.e. the balances of "Total") defined on-chain
  //Then, we treat each new key in the map as a transfer from "Mint" to the address
  //If it underflows, we throw an error because the balancesUri is lying or overallocating balances

  //If the provided balances map is the same as the balances map in the database, we do not need to update the balances docs and we only update the fetchedAt properties.
  //Else, we update any new balances
  const docs: DocsCache = {
    accounts: {},
    collections: {},
    balances: {},
    refreshes: {},
    merkleChallenges: {},
    approvalTrackers: {},
    addressLists: {},
    passwordDocs: {},
    claimAlertsToAdd: [],
    activityToAdd: [],
    queueDocsToAdd: [],
    protocols: {},
    userProtocolCollections: {},
  };

  try {

    //We have to update the existing balances with the new balances, if the collection already exists
    //This is a complete overwrite of the balances (i.e. we fetch all the balances from the balancesUri and overwrite the existing balances
    const mapKeys = [];

    const balanceMapKeys = Object.keys(balanceMap);

    const newBalanceMap: OffChainBalancesMap<bigint> = {};
    for (const key of balanceMapKeys) {
      const res = await getAddressListsFromDB([{ listId: key }], false);
      const addressList = res[0];

      if (!addressList.whitelist) {
        throw new Error("Blacklists are not supported for address lists: " + key);
      }
      if (addressList.listId.indexOf("_") >= 0) {
        throw new Error("Address lists cannot be off-chain: " + key);
      }
      if (mapKeys.length + addressList.addresses.length > MAX_NUM_ADDRESSES) {
        throw new Error(`Too many addresses in balances map. Max allowed currently for scalability is ${MAX_NUM_ADDRESSES}.`);
      }

      const addresses = addressList.addresses.map(x => convertToCosmosAddress(x))
      mapKeys.push(...addresses);
      for (const address of addresses) {
        newBalanceMap[address] = balanceMap[key];
      }
    }

    balanceMap = newBalanceMap;

    if (mapKeys.length > MAX_NUM_ADDRESSES) {
      throw new Error(`Too many addresses in balances map. Max allowed currently for scalability is ${MAX_NUM_ADDRESSES}.`);
    }

    //Check the total doc first. If undefined, we can assume the rest are undefined (since this collection has never had balances before)
    //Saves us from fetching 10000+ or however many undefined docs if we dont need to

    await fetchDocsForCacheIfEmpty(docs, [], [], [
      `${queueObj.collectionId}:Mint`,
      `${queueObj.collectionId}:Total`,
    ], [], [], [], [], [], []);

    const mintDoc = docs.balances[`${queueObj.collectionId}:Mint`];
    if (!mintDoc) throw new Error('Mint doc not found');

    const totalDoc = docs.balances[`${queueObj.collectionId}:Total`];
    if (!totalDoc) throw new Error('Total doc not found');

    const isContentSameAsLastUpdate = (totalDoc.contentHash && balanceMapHash === totalDoc.contentHash);
    if (isContentSameAsLastUpdate) {
      docs.balances[`${queueObj.collectionId}:Mint`] = {
        ...convertBalanceDoc(mintDoc, BigIntify),
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: block,
      }

      docs.balances[`${queueObj.collectionId}:Total`] = {
        ...convertBalanceDoc(totalDoc, BigIntify),
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: block,
      }
    } else {
      //TODO: we pretty much just fetch this twice. Just set docs from this fetch
      //mongo query is much faster than fetchDocsForCacheIfEmpty for large queries (49ms -> 381ms)

      const allPreviousDocIds = await BalanceModel.find({
        collectionId: Number(queueObj.collectionId),
      }).lean().exec();

      const allIdsToFetch = new Set([
        ...mapKeys.map((key) => `${queueObj.collectionId}:${key}`),
        ...allPreviousDocIds.map(x => x._docId),
      ]);

      await fetchDocsForCacheIfEmpty(docs, [], [], [...allIdsToFetch], [], [], [], [], [], []);

      const docBalancesCopy = deepCopy(docs.balances);
      //Set all balances to empty array
      for (const key of allIdsToFetch) {
        let balanceDoc = docs.balances[`${key}`];
        if (!balanceDoc) continue //For TS, we know it exists
        if (balanceDoc.cosmosAddress === 'Mint' || balanceDoc.cosmosAddress === 'Total') continue;

        balanceDoc = {
          ...balanceDoc,
          balances: [],
        }
        docs.balances[`${key}`] = balanceDoc;
      }

      const totalSupplysDoc = docs.balances[`${queueObj.collectionId}:Total`];
      if (!totalSupplysDoc) throw new Error('Total supplys doc not found');

      docs.balances[`${queueObj.collectionId}:Total`] = {
        ...totalSupplysDoc,
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: block,
        uri: queueObj.uri,
        isPermanent: queueObj.uri.startsWith('ipfs://'),
        contentHash: balanceMapHash,
      }


      let remainingSupplys = totalSupplysDoc.balances.map(x => convertBalance(x, BigIntify));

      //Update the balance documents
      const entries = Object.entries(balanceMap);


      for (const [key, val] of entries) {
        if (isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS) {
          docs.balances[`${queueObj.collectionId}:${key}`] = {
            _docId: `${queueObj.collectionId}:${key}`,
            balances: val,
            //Off-Chain Balances so we don't care ab approvals or permissions
            incomingApprovals: [],
            outgoingApprovals: [],
            userPermissions: {
              canUpdateIncomingApprovals: [],
              canUpdateOutgoingApprovals: [],
              canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
              canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
            },
            collectionId: queueObj.collectionId,
            cosmosAddress: key,
            autoApproveSelfInitiatedIncomingTransfers: false,
            autoApproveSelfInitiatedOutgoingTransfers: false,
            onChain: false,
            updateHistory: [],
          };

          //Will throw if underflow and the URI speecifies more badges than what is denoted on the blockchain
          //This is to enforce that the balancesUri is not lying or overallocating balances 
          for (const balance of val) {
            remainingSupplys = subtractBalances([{
              badgeIds: balance.badgeIds,
              amount: balance.amount,
              ownershipTimes: balance.ownershipTimes
            }], remainingSupplys);
          }
        }
      }


      docs.balances[`${queueObj.collectionId}:Mint`] = {
        _docId: `${queueObj.collectionId}:Mint`,
        balances: remainingSupplys.map(x => convertBalance(x, BigIntify)),
        //Off-Chain Balances so we don't care ab approvals or permissions
        incomingApprovals: [],
        outgoingApprovals: [],
        userPermissions: {
          canUpdateIncomingApprovals: [],
          canUpdateOutgoingApprovals: [],
          canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
          canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        },
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        collectionId: queueObj.collectionId,
        cosmosAddress: "Mint",
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: block,
        onChain: false,
        uri: queueObj.uri,
        isPermanent: queueObj.uri.startsWith('ipfs://'),
        updateHistory: []
      };

      //Delete all docs that were not updated to avoid unnecessary writes to DB using the saved docBalancesCopy
      //Also merge balance docs if balances are equal so that we create one doc with X to addresses instead of X docs with 1 to address
      //uses binary search here to make it a little quicker.
      const docsEntries = Object.entries(docs.balances);

      for (const [key, val] of docsEntries) {
        if (!val) continue
        if (val.cosmosAddress === 'Mint' || val.cosmosAddress === 'Total') continue;

        if (docBalancesCopy[key]?.balances && compareObjects(docBalancesCopy[key]?.balances, val?.balances)) {
          delete docs.balances[key];
        } else {
          const balances = val.balances.map(x => convertBalance(x, BigIntify));
          //We want to include any updated badges that now have zero balance 
          //(e.g. going from [x1 ID 1] -> [x1 of ID 2], we want to display x0 of ID 1 and x1 of ID 2)

          const prevBalances = docBalancesCopy[key]?.balances.map(x => convertBalance(x, BigIntify)) ?? [];
          const inOldButNotNew = subtractBalances(balances, prevBalances, true).filter(x => x.amount > 0n);

          //These values are not in the new (x0 amount)
          //We want to add them to the balances doc with amount 0
          if (inOldButNotNew.length > 0) {
            balances.push(...inOldButNotNew.map(x => {
              return {
                ...x,
                amount: 0n,
              }
            }));
          }


          const newActivity: TransferActivityDoc<bigint> = {
            _docId: crypto.randomBytes(16).toString('hex'),
            from: 'Mint',
            to: [val.cosmosAddress],
            collectionId: BigInt(val.collectionId),
            balances: balances,
            timestamp: BigInt(Date.now()),
            memo: '',
            initiatedBy: '',
            prioritizedApprovals: [],
            onlyCheckPrioritizedApprovals: false,
            precalculateBalancesFromApproval: {
              approvalId: '',
              approvalLevel: '',
              approverAddress: '',
            },
            block: block,
          }

          docs.activityToAdd.push(newActivity);
        }
      }
    }

    if (TIME_MODE && QUEUE_TIME_MODE) console.time('handleBalances - flush only');
    if (TIME_MODE && QUEUE_TIME_MODE) console.log("Flushing docs (balances, activityToAdd)", Object.keys(docs.balances).length, docs.activityToAdd.length);
    await flushCachedDocs(docs)

  } catch (e) {
    console.log(serializeError(e));
    await ErrorModel.create({
      _docId: crypto.randomBytes(16).toString('hex'),
      error: serializeError(e),
    });

    console.log("Error in handleBalances");
    throw e;
  }
  if (TIME_MODE && QUEUE_TIME_MODE) console.timeEnd('handleBalances - flush only');
  if (TIME_MODE && QUEUE_TIME_MODE) console.timeEnd('handleBalances');


  return docs //For testing
}

export const handleQueueItems = async (block: bigint) => {
  //To prevent spam and bloated metadata, we set the following parameters.
  //If we cannot fetch within the parameters, it will remain in the queue and will be fetched again.
  const NUM_METADATA_FETCHES_PER_BLOCK = process.env.NUM_METADATA_FETCHES_PER_BLOCK ? Number(process.env.NUM_METADATA_FETCHES_PER_BLOCK) : 25;
  const BASE_DELAY = process.env.BASE_DELAY ? Number(process.env.BASE_DELAY) : 1000 * 60 * 60 * 1; //1 hour
  let numFetchesLeft = NUM_METADATA_FETCHES_PER_BLOCK;

  const numDocsInDB = await QueueModel.countDocuments();
  if (numDocsInDB == 0) return;


  const queueRes = await QueueModel.find({
    _docId: { $exists: true },
    loadBalanceId: LOAD_BALANCER_ID,
    nextFetchTime: {
      "$lte": Date.now() - 1000 * 5 * 1 //If it is too quick, we sometimes have data race issues
    },
    deletedAt: {
      "$exists": false
    },
  }).limit(NUM_METADATA_FETCHES_PER_BLOCK).lean().exec();

  const queue = queueRes.map((doc) => convertQueueDoc(doc, BigIntify));
  const queueItems: (QueueDoc<bigint> & nano.DocumentGetResponse)[] = [];

  while (numFetchesLeft > 0 && queue.length > 0) {
    const currQueueDoc = queue[0];
    if (currQueueDoc) {
      //We don't add two of the same URI bc that can cause race conditions with the deletes, plus it is redundant (i.e. we only need to fetch once)
      if (!queueItems.find(x => x.uri === currQueueDoc.uri)) {
        queueItems.push(convertQueueDoc(currQueueDoc, BigIntify) as any); //Used for a deep copy
      }
    }
    queue.shift()
    numFetchesLeft--;
  }

  const executeFunc = async (queueObj: QueueDoc<bigint>) => {
    try {
      await fetchUriFromSourceAndUpdateDb(queueObj.uri, queueObj, block);
      const queueDocs = await QueueModel.find({
        uri: queueObj.uri,
      }).lean().exec();

      const queueDocsIds = queueDocs.map(x => x._docId);
      await deleteMany(QueueModel, queueDocsIds);
    } catch (e) {
      let reason = '';
      try {
        reason = e.toString();
      } catch (e) {
        try {
          reason = JSON.stringify(e);
        } catch (e) {
          reason = 'Could not stringify error message';
        }
      }
      const delay = BASE_DELAY * Math.pow(2, Number(queueObj.numRetries + 1n));

      await insertToDB(QueueModel, {
        ...queueObj,
        lastFetchedAt: BigInt(Date.now()),
        error: reason,
        numRetries: BigInt(queueObj.numRetries + 1n),
        nextFetchTime: BigInt(delay) + BigInt(Date.now()),
      });
    }
  }


  const promises = queueItems.map(async (queueObj) => {
    if (queueObj.emailMessage && queueObj.recipientAddress && queueObj.activityDocId && queueObj.notificationType) {
      await sendPushNotification(queueObj.recipientAddress, queueObj.notificationType, queueObj.emailMessage, queueObj.activityDocId, queueObj)
    } else {

      await executeFunc(queueObj);
    }
  });

  if (promises.length) await Promise.all(promises);
}
