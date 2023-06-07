import { MsgNewCollection } from "bitbadgesjs-transactions"
import { BitBadgesUserInfo, CollectionDoc, StatusDoc, DocsCache, Metadata, MetadataMap, simulateCollectionAfterMsgNewCollection } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleClaims } from "./claims"

import { getBalancesIdForQueueDb, getCollectionIdForQueueDb, pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../metadata-queue"
import { getLoadBalancerId } from "../utils/loadBalancer"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgNewCollection = async (msg: MsgNewCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {

  /**
   * Here, we simulate the collection creation to get a Collection object.
   * 
   * Note we handle transfers, claims, and balances separately below. The returned collection object is not used for these.
   * 
   * All other types are not used in this simulation (just set to default for TypeScript)
   */
  const createdCollection = simulateCollectionAfterMsgNewCollection({
    ...msg, details: [], transfers: [], claims: []
  }, {} as Metadata<bigint>, {} as MetadataMap<bigint>, {} as BitBadgesUserInfo<bigint>)

  const collection: CollectionDoc<bigint> = {
    _id: status.nextCollectionId.toString(),
    _rev: '',

    //Add any fields that were not simulated
    collectionId: status.nextCollectionId, //msg does not have a collectionId. we keep track of the next collectionId in the status object with a counter
    manager: msg.creator, //Added manually because we did not provide connectedUser parameter
    createdBlock: status.block.height,

    //These fields are simulated
    collectionUri: createdCollection.collectionUri,
    badgeUris: createdCollection.badgeUris,
    bytes: createdCollection.bytes,
    permissions: createdCollection.permissions,
    allowedTransfers: createdCollection.allowedTransfers,
    managerApprovedTransfers: createdCollection.managerApprovedTransfers,
    nextBadgeId: createdCollection.nextBadgeId,
    nextClaimId: createdCollection.nextClaimId,
    balancesUri: createdCollection.balancesUri,
    unmintedSupplys: createdCollection.unmintedSupplys,
    maxSupplys: createdCollection.maxSupplys,
    standard: createdCollection.standard,
    managerRequests: createdCollection.managerRequests,
  }

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [collection.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  docs.collections[collection.collectionId.toString()] = {
    ...collection
  };

  await handleClaims(docs, msg.claims, collection.collectionId, 0, status); // Keep this here because we need a filled out collectionDoc for nextClaimId

  status.nextCollectionId++;

  await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);

  const entropy = status.block.height + "-" + status.block.txIndex;

  const docId = getCollectionIdForQueueDb(entropy, collection.collectionId.toString());
  const balanceDocId = getBalancesIdForQueueDb(entropy, collection.collectionId.toString());
  await pushCollectionFetchToQueue(docs, collection, getLoadBalancerId(docId), status.block.timestamp, entropy);
  await pushBalancesFetchToQueue(docs, collection, getLoadBalancerId(balanceDocId), status.block.timestamp, entropy);

  docs.refreshes[collection.collectionId.toString()] = {
    _id: collection.collectionId.toString(),
    _rev: '',
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp,
  }
}