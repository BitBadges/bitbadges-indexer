import { MessageMsgNewCollection } from "bitbadgesjs-transactions"
import { BitBadgesUserInfo, Collection, DbStatus, DocsCache, Metadata, MetadataMap, simulateCollectionAfterMsgNewCollection } from "bitbadgesjs-utils"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { handleClaims } from "./claims"

import { handleTransfers } from "./handleTransfers"
import { updateBalancesForOffChainBalances } from "./offChainBalances"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgNewCollection = async (msg: MessageMsgNewCollection, status: DbStatus, docs: DocsCache): Promise<void> => {

  /**
   * Here, we simulate the collection creation to get a Collection object.
   * 
   * Note we handle transfers, claims, and balances separately below. The returned collection object is not used for these.
   * 
   * All other types are not used in this simulation (just set to default for TypeScript)
   */
  const createdCollection = simulateCollectionAfterMsgNewCollection({
    ...msg, claims: [], transfers: []
  }, {} as Metadata, {} as MetadataMap, {} as BitBadgesUserInfo)

  const collection: Collection = {
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

  await fetchDocsForRequestIfEmpty(docs, [msg.creator], [collection.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);
  await pushToMetadataQueue(collection, status);
  await updateBalancesForOffChainBalances(collection, docs, true); //Only if off-chain balances are used (i.e. standard == 1)

  let collectionDoc = docs.collections[collection.collectionId.toString()];
  collectionDoc = {
    _id: collectionDoc._id,
    ...collection
  };

  await handleClaims(docs, msg.claims, collection.collectionId); // Keep this here because we need a filled out collectionDoc for nextClaimId

  status.nextCollectionId++;

  await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);
}