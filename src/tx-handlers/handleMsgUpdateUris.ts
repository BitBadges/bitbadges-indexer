import { MsgUpdateUris } from "bitbadgesjs-transactions";
import { fetchDocsForCacheIfEmpty } from "../db/cache";
import { getBalancesIdForQueueDb, getCollectionIdForQueueDb, pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../metadata-queue";

import { DocsCache, StatusDoc } from "bitbadgesjs-utils";
import { getLoadBalancerId } from "src/utils/loadBalancer";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgUpdateUris = async (msg: MsgUpdateUris<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because Msg can only be called if the collection exists
  const collection = docs.collections[msg.collectionId.toString()];
  if (!collection) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);


  //Only update the URIs if the collectionUri or badgeUris were specified and changed
  let newCollectionUri = collection.collectionUri;
  let updateCollectionMetadata = false;
  let newBadgeUris = collection.badgeUris;
  let newBalancesUri = collection.balancesUri;
  let updateBalancesUri = false;
  if (msg.collectionUri != "" && msg.collectionUri != collection.collectionUri) {
    newCollectionUri = msg.collectionUri;
    updateCollectionMetadata = true;
  }
  if (msg.badgeUris && msg.badgeUris.length > 0) {
    newBadgeUris = msg.badgeUris;
  }

  if (msg.balancesUri != "" && msg.balancesUri != collection.balancesUri) {
    newBalancesUri = msg.balancesUri;
    updateBalancesUri = true;
  }

  collection.collectionUri = newCollectionUri;
  collection.badgeUris = newBadgeUris;
  collection.balancesUri = newBalancesUri;

  const entropy = status.block.height + "-" + status.block.txIndex;

  const docId = getCollectionIdForQueueDb(entropy, collection.collectionId.toString());
  if (updateCollectionMetadata) {
    await pushCollectionFetchToQueue(docs, collection, getLoadBalancerId(docId), status.block.timestamp, entropy);
  }

  const balanceDocId = getBalancesIdForQueueDb(entropy, collection.collectionId.toString());
  if (updateBalancesUri) {
    await pushBalancesFetchToQueue(docs, collection, getLoadBalancerId(balanceDocId), status.block.timestamp, entropy);
  }
}