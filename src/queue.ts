import axios from "axios";
import { AddressMapping, JSPrimitiveNumberType, MerkleChallenge, convertBalance, deepCopy } from "bitbadgesjs-proto";
import { BigIntify, BitBadgesCollection, CollectionDoc, DocsCache, FetchDoc, Numberify, OffChainBalancesMap, QueueDoc, RefreshDoc, SupportedChain, TransferActivityInfoBase, convertBalanceDoc, convertFetchDoc, convertOffChainBalancesMap, convertQueueDoc, convertRefreshDoc, getChainForAddress, getCurrentIdxForTimeline, getMaxMetadataId, getUrisForMetadataIds, isAddressValid, subtractBalances } from "bitbadgesjs-utils";
import nano from "nano";
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from "./db/cache";
import { BALANCES_DB, FETCHES_DB, QUEUE_DB, REFRESHES_DB, insertToDB } from "./db/db";
import { LOAD_BALANCER_ID, TIME_MODE } from "./indexer";
import { getFromIpfs } from "./ipfs/ipfs";
import { compareObjects } from "./utils/compare";
import { catch404 } from "./utils/couchdb-utils";
import { cleanBalances, cleanMerkleChallenges, cleanMetadata } from "./utils/dataCleaners";
import { getLoadBalancerId } from "./utils/loadBalancer";
import { QUEUE_TIME_MODE } from "./poll";

//1. Upon initial TX (new collection or URIs updating): 
// 	1. Trigger collection, claims, first X badges, and balances to queue in QUEUE_DB
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
  //TODO: Get _conflicts and only take the one with latest time
  //Check if we need to refresh

  const fetchDocPromise = FETCHES_DB.get(uri).catch(catch404);
  const refreshDocPromise = REFRESHES_DB.get(collectionId);

  [fetchDoc, refreshDoc] = await Promise.all([fetchDocPromise, refreshDocPromise]);

  if (!fetchDoc || refreshDoc.refreshRequestTime > fetchDoc.fetchedAt) {
    needsRefresh = true;
    refreshRequestTime = Number(refreshDoc.refreshRequestTime);
  }

  /*
    Below, we use a clever approach to prevent multiple queue documents for the same URI and same refresh request.
    This is in case the REFRESHES_DB is ahead of the QUEUE_DB. If REFRESHES_DB is ahead, we do not want
    all N nodes to pick up on the fact that it needs a refresh and create N separate queue documents. Instead, we want
    only one queue document to be created. To do this, we use the _rev of the refresh document as the _id of the queue document.
    This way, the same exact document is created by all N nodes and will not cause any conflicts.
  */

  //If not already in queue and we need to refresh, add to queue
  if (needsRefresh) {

    //Check if already in queue
    const res = await QUEUE_DB.get(`${uri}-${refreshDoc._rev}`).catch(catch404);
    if (res) {
      alreadyInQueue = true;
    }

    if (!alreadyInQueue) {
      const loadBalanceId = getLoadBalancerId(`${uri}-${refreshDoc._rev}`); //`${uri}-${refreshDoc._rev}

      await insertToDB(QUEUE_DB, {
        _id: `${uri}-${refreshDoc._rev}`,
        _rev: undefined,
        uri: uri,
        collectionId: collectionId,
        refreshRequestTime,
        numRetries: 0,
        loadBalanceId,
        nextFetchTime: BigInt(Date.now(),)
      });
    }
  }

  return {
    content: fetchDoc ? fetchDoc.content : undefined,
    updating: alreadyInQueue || needsRefresh,
    fetchedAt: fetchDoc ? fetchDoc.fetchedAt : 0n,
    fetchedAtBlock: fetchDoc ? fetchDoc.fetchedAtBlock : 0n,
    uri: uri,
  };
}

export const fetchUriFromSourceAndUpdateDb = async (uri: string, queueObj: QueueDoc<bigint>, block: bigint) => {
  let fetchDoc: (FetchDoc<bigint> & nano.IdentifiedDocument & nano.MaybeRevisionedDocument) | undefined;
  let needsRefresh = false;
  let dbType: 'MerkleChallenge' | 'Metadata' | 'Balances' = 'Metadata';



  //Get document from cache if it exists
  const _fetchDoc = await FETCHES_DB.get(uri).catch(catch404);
  fetchDoc = _fetchDoc ? convertFetchDoc(_fetchDoc, BigIntify) : undefined;

  //If permanent, do not need to fetch from source
  if (fetchDoc && fetchDoc.isPermanent) {
    await insertToDB(FETCHES_DB, {
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
    let res: any;
    let isPermanent = false;
    //If we are here, we need to fetch from the source
    if (uri.startsWith('ipfs://')) {
      const _res: any = await getFromIpfs(uri.replace('ipfs://', ''));

      res = JSON.parse(_res.file);
      isPermanent = true;
    } else {
      const _res = await axios.get(uri).then((res) => res.data);
      res = _res;
    }

    //Handle different types of docs
    if (res.image) { //res.image is required for all metadata and not included in any other type
      dbType = 'Metadata';
      res = cleanMetadata(res);
    } else if (Object.keys(res).every((key) => isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS)) { //If it has at least one valid address as a key, it is a balances doc
      dbType = 'Balances';
      res = cleanBalances(res);
      res = convertOffChainBalancesMap(res, BigIntify);

      //Compare res and fetchDoc.content and only update trigger balances writes if they are different. Else, just update fetchedAt
      const contentIsSame = fetchDoc && fetchDoc.content && compareObjects(fetchDoc.content, res);

      await handleBalances(res, queueObj, block, contentIsSame);
    } else {
      dbType = 'MerkleChallenge';
      res = cleanMerkleChallenges(res);
    }

    await insertToDB(FETCHES_DB, {
      ...fetchDoc,
      _id: uri,
      _rev: fetchDoc ? fetchDoc._rev : undefined,
      //TODO: If dbType == Balances, we should not store the content here. We already stored balances in a separate DB so it makes no sense to doubly store content here. 
      //      Same with addBalancesToIpfs. However, it gets a little weird bc we don't call handleBalances when we upload to IPFS but we do here.
      content: res,

      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: block,
      db: dbType,
      isPermanent,
    });
  }
}

const MIN_TIME_BETWEEN_REFRESHES = process.env.MIN_TIME_BETWEEN_REFRESHES ? BigInt(process.env.MIN_TIME_BETWEEN_REFRESHES) : BigInt(1000 * 60 * 60); //1 hour
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
      _id: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), collection.collectionMetadataTimeline.find(x => x.collectionMetadata.uri === uri)?.timelineTimes[0].start.toString() ?? "") : undefined,
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
          _id: deterministicEntropy ? getCollectionIdForQueueDb(deterministicEntropy, collection.collectionId.toString(), timelineVal.timelineTimes[0]?.start.toString() ?? "", `${i}`) : undefined,
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

export const getAddressMappingIdForQueueDb = (entropy: string, mappingId: string) => {
  return entropy + "-addressMapping-" + mappingId.toString()
}

export const pushAddressMappingFetchToQueue = async (docs: DocsCache, mapping: AddressMapping, refreshTime: bigint, deterministicEntropy?: string) => {
  docs.queueDocsToAdd.push({
    _id: deterministicEntropy ? getAddressMappingIdForQueueDb(deterministicEntropy, mapping.mappingId) : undefined,
    uri: mapping.uri,
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
  //This is because BALANCES_DB is a complete overwrite of the balances, so we don't want to overwrite the balances with the wrong balances
  //Also note that there is no need to specify >1 timeline values because they can just do so with ownership times
  let idx = getCurrentIdxForTimeline(collection.offChainBalancesMetadataTimeline);
  idx = idx == -1 ? 0 : idx;
  const timelineVal = collection.offChainBalancesMetadataTimeline[Number(idx)];
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
    loadBalanceId: BigInt(loadBalanceId),

    nextFetchTime: BigInt(Date.now()),
  })


}


const MAX_NUM_ADDRESSES = 15000;

const handleBalances = async (balancesMap: OffChainBalancesMap<bigint>, queueObj: QueueDoc<bigint>, block: bigint, onlyUpdateFetchedAt?: boolean) => {

  if (TIME_MODE && QUEUE_TIME_MODE) console.time('handleBalances');
  //Pretty much, this function is responsible for updating the balances docs in BALANCES_DB for off-chain balance JSONs 
  //This is to make them compatible with our existing on-chain balances docs in BALANCES_DB
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
    approvalsTrackers: {},
    addressMappings: {},
    passwordDocs: {},
    claimAlertsToAdd: [],
    activityToAdd: [],
    queueDocsToAdd: [],
  };



  //Handle balance doc creation
  let balanceMap = balancesMap;
  //We have to update the existing balances with the new balances, if the collection already exists
  //This is a complete overwrite of the balances (i.e. we fetch all the balances from the balancesUri and overwrite the existing balances




  const mapKeys = Object.keys(balanceMap).filter(key => isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS)
  if (mapKeys.length == 0) {
    throw new Error('No valid addresses found in balances map');
  }

  //Check a single doc first. If undefined, we can assume the rest are undefined
  //Saves us from fetching 10000+ or however many undefined docs if we dont need to
  const sanityCheckDoc = await BALANCES_DB.head(`${queueObj.collectionId}:${mapKeys[0]}`).catch(catch404);

  await fetchDocsForCacheIfEmpty(docs, [], [], [
    `${queueObj.collectionId}:Mint`,
    `${queueObj.collectionId}:Total`,
  ], [], [], [], []);

  const mintDoc = docs.balances[`${queueObj.collectionId}:Mint`];
  if (!mintDoc) throw new Error('Mint doc not found');

  const totalDoc = docs.balances[`${queueObj.collectionId}:Total`];
  if (!totalDoc) throw new Error('Total doc not found');

  const isContentSameAsLastUpdate = onlyUpdateFetchedAt || (sanityCheckDoc && mintDoc.uri === queueObj.uri && mintDoc.isPermanent);
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

    await fetchDocsForCacheIfEmpty(docs, [], [], sanityCheckDoc ? [
      ...mapKeys.map((key) => `${queueObj.collectionId}:${key}`),
    ] : [], [], [], [], []);

    const docBalancesCopy = deepCopy(docs.balances);


    const totalSupplysDoc = docs.balances[`${queueObj.collectionId}:Total`];
    if (!totalSupplysDoc) throw new Error('Total supplys doc not found');

    docs.balances[`${queueObj.collectionId}:Total`] = {
      ...totalSupplysDoc,
      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: block,
      uri: queueObj.uri,
      isPermanent: queueObj.uri.startsWith('ipfs://')
    }


    let remainingSupplys = totalSupplysDoc.balances.map(x => convertBalance(x, BigIntify));

    //Update the balance documents
    const entries = Object.entries(balanceMap);
    if (entries.length > MAX_NUM_ADDRESSES) {
      throw new Error(`Too many addresses in balances map. Max allowed currently for scalability is ${MAX_NUM_ADDRESSES}.`);
    }

    for (const [key, val] of entries) {
      if (isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS) {
        docs.balances[`${queueObj.collectionId}:${key}`] = {
          _rev: docs.balances[`${queueObj.collectionId}:${key}`]?._rev ?? undefined,
          _id: `${queueObj.collectionId}:${key}`,
          balances: val,
          //Off-Chain Balances so we don't care ab approvals or permissions
          approvedIncomingTransfers: [],
          approvedOutgoingTransfers: [],
          userPermissions: {
            canUpdateApprovedIncomingTransfers: [],
            canUpdateApprovedOutgoingTransfers: [],
          },
          collectionId: queueObj.collectionId,
          cosmosAddress: key,

          onChain: false,
          updateHistory: [],
        };

        //Will throw if underflow and the URI speecifies more badges than what is denoted on the blockchain
        //This is to enforce that the balancesUri is not lying or overallocating balances 
        for (const balance of val) {
          // console.log(JSON.stringify(remainingSupplys));
          remainingSupplys = subtractBalances([{
            badgeIds: balance.badgeIds,
            amount: balance.amount,
            ownershipTimes: balance.ownershipTimes
          }], remainingSupplys);
        }
      }
    }


    docs.balances[`${queueObj.collectionId}:Mint`] = {
      _rev: docs.balances[`${queueObj.collectionId}:Mint`]?._rev ?? undefined,
      _id: `${queueObj.collectionId}:Mint`,
      balances: remainingSupplys.map(x => convertBalance(x, BigIntify)),
      //Off-Chain Balances so we don't care ab approvals or permissions
      approvedIncomingTransfers: [],
      approvedOutgoingTransfers: [],
      userPermissions: {
        canUpdateApprovedIncomingTransfers: [],
        canUpdateApprovedOutgoingTransfers: [],
      },
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
      if (docBalancesCopy[key] && compareObjects(docBalancesCopy[key], val)) {
        delete docs.balances[key];
      } else {
        if (!val) continue
        if (val.cosmosAddress === 'Mint' || val.cosmosAddress === 'Total') continue;

        // //binary search
        // let high = docs.activityToAdd.length - 1;
        // let low = 0;
        // let mid = 0;
        // let existingActivity: (TransferActivityInfoBase<bigint> & nano.MaybeIdentifiedDocument) | undefined;
        // //TODO: This is really not optimized if start is same but balances are not
        // //      We are kinda banking on how the website has it (i.e. start is same if balances are same or incremented IDs)
        // while (low <= high) {
        //   mid = Math.floor((low + high) / 2);
        //   if (docs.activityToAdd[mid].balances[0].badgeIds[0].start === val.balances[0].badgeIds[0].start) {
        //     if (compareObjects(docs.activityToAdd[mid].balances[0], val.balances[0])) {
        //       existingActivity = docs.activityToAdd[mid];
        //       break;
        //     } else {
        //       //There could be multiple with the same start, so we just want to iterate over all them and find if any match
        //       let end = mid;
        //       while (docs.activityToAdd[end].balances[0].badgeIds[0].start === val.balances[0].badgeIds[0].start) {
        //         end++;
        //       }
        //       let start = mid;
        //       while (docs.activityToAdd[start].balances[0].badgeIds[0].start === val.balances[0].badgeIds[0].start) {
        //         start--;
        //       }
        //       for (let i = start; i <= end; i++) {
        //         if (compareObjects(docs.activityToAdd[i].balances[0], val.balances[0])) {
        //           existingActivity = docs.activityToAdd[i];
        //           break;
        //         }
        //       }
        //     }
        //   } else if (docs.activityToAdd[mid].balances[0].badgeIds[0].start < val.balances[0].badgeIds[0].start) {
        //     low = mid + 1;
        //   } else {
        //     high = mid - 1;
        //   }
        // }


        // if (existingActivity) {
        //   existingActivity.to.push(val.cosmosAddress);
        // } else {
        const newActivity: TransferActivityInfoBase<bigint> & nano.MaybeIdentifiedDocument = {
          _id: `collection-${val.collectionId}:bal_-${val.cosmosAddress}-${mintDoc.fetchedAt}`,
          method: 'Transfer',
          from: 'Mint',
          to: [val.cosmosAddress],
          collectionId: BigInt(val.collectionId),
          balances: val.balances.map(x => convertBalance(x, BigIntify)),
          timestamp: BigInt(Date.now()),
          memo: '',
          initiatedBy: '',
          prioritizedApprovals: [],
          onlyCheckPrioritizedApprovals: false,
          precalculationDetails: {
            approvalId: '',
            approvalLevel: '',
            approverAddress: '',
          },
          block: block,
        }

        // //Get idx to insert
        // let low = 0;
        // let high = docs.activityToAdd.length - 1;
        // let mid = 0;
        // while (low <= high) {
        //   mid = Math.floor((low + high) / 2);
        //   if (docs.activityToAdd[mid].balances[0].badgeIds[0].start === val.balances[0].badgeIds[0].start) {
        //     break;
        //   } else if (docs.activityToAdd[mid].balances[0].badgeIds[0].start < val.balances[0].badgeIds[0].start) {
        //     low = mid + 1;
        //   } else {
        //     high = mid - 1;
        //   }
        // }

        // if (mid > docs.activityToAdd.length - 1) {
        //   docs.activityToAdd.push(newActivity);
        // } else {
        //   const idx = docs.activityToAdd[mid].balances[0].badgeIds[0].start === val.balances[0].badgeIds[0].start ? mid : mid + 1;
        //   docs.activityToAdd.splice(idx, 0, newActivity);
        // }

        // }
        docs.activityToAdd.push(newActivity);
      }
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) console.time('handleBalances - flush only');
  if (TIME_MODE && QUEUE_TIME_MODE) console.log("Flushing docs (balances, activityToAdd)", Object.keys(docs.balances).length, docs.activityToAdd.length);
  //TODO: Eventually, we should make this a transactional all-or-nothing update with QUEUE_DB.destroy
  await flushCachedDocs(docs);
  if (TIME_MODE && QUEUE_TIME_MODE) console.timeEnd('handleBalances - flush only');

  if (TIME_MODE && QUEUE_TIME_MODE) console.timeEnd('handleBalances');
}

export const fetchUrisFromQueue = async (block: bigint) => {
  //To prevent spam and bloated metadata, we set the following parameters.
  //If we cannot fetch within the parameters, it will remain in the queue and will be fetched again.
  const NUM_METADATA_FETCHES_PER_BLOCK = process.env.NUM_METADATA_FETCHES_PER_BLOCK ? Number(process.env.NUM_METADATA_FETCHES_PER_BLOCK) : 25;
  const BASE_DELAY = process.env.BASE_DELAY ? Number(process.env.BASE_DELAY) : 1000 * 60 * 60 * 1; //1 hour
  let numFetchesLeft = NUM_METADATA_FETCHES_PER_BLOCK;

  //Random skip amount so we don't fetch the same every time
  const numDocsInDB = await QUEUE_DB.info().then((res) => res.doc_count);
  if (numDocsInDB == 0) return;

  const queueRes = await QUEUE_DB.find({
    selector: {
      _id: { $gt: null },
      loadBalanceId: {
        "$eq": LOAD_BALANCER_ID
      },
      nextFetchTime: {
        "$lte": Date.now()
      },
    },
    limit: NUM_METADATA_FETCHES_PER_BLOCK
  });

  const queue = queueRes.docs.map((doc) => convertQueueDoc(doc, BigIntify));
  const queueItems: (QueueDoc<bigint> & nano.DocumentGetResponse)[] = [];

  while (numFetchesLeft > 0 && queue.length > 0) {
    const currQueueDoc = queue[0];
    if (currQueueDoc) {
      queueItems.push(convertQueueDoc(currQueueDoc, BigIntify) as any); //Used for a deep copy
    }
    queue.shift()
    numFetchesLeft--;
  }
  const promises = [];
  for (const queueObj of queueItems) {
    promises.push(fetchUriFromSourceAndUpdateDb(queueObj.uri, queueObj, block));
  }

  //If fulfilled, delete from queue (after creating balance docs if necessary).
  //If rejected, do nothing (it will remain in queue)
  const results = await Promise.allSettled(promises);

  const handlingPromises = [];
  for (let i = 0; i < results.length; i++) {
    let queueObj = queueItems[i];
    let result = results[i];

    if (result.status == 'fulfilled') {
      try {
        handlingPromises.push(insertToDB(QUEUE_DB, {
          ...queueObj,
          _deleted: true,
          deletedAt: BigInt(Date.now()),
        }));
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
      const delay = BASE_DELAY * Math.pow(2, Number(queueObj.numRetries + 1n));

      handlingPromises.push(insertToDB(QUEUE_DB, {
        ...queueObj,
        lastFetchedAt: BigInt(Date.now()),
        error: reason,
        numRetries: BigInt(queueObj.numRetries + 1n),
        nextFetchTime: BigInt(delay) + BigInt(Date.now()),
      }));

      console.error(result.reason);
    }
  }

  await Promise.all(handlingPromises);
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
