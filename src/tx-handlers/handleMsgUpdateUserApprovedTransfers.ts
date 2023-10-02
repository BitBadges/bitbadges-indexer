import { MsgUpdateUserApprovedTransfers } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"

import { handleNewAccountByAddress } from "./handleNewAccount"
import { recursivelyDeleteFalseProperties } from "./handleMsgUpdateCollection"

export const handleMsgUpdateUserApprovedTransfers = async (msg: MsgUpdateUserApprovedTransfers<bigint>, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  recursivelyDeleteFalseProperties(msg);

  await fetchDocsForCacheIfEmpty(docs, [], [msg.collectionId], [
    `${msg.collectionId}:${msg.creator}`,
  ], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  const collectionDoc = docs.collections[`${msg.collectionId}`];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId} does not exist`);

  let balancesDoc = docs.balances[`${msg.collectionId}:${msg.creator}`];
  if (!balancesDoc) {
    balancesDoc = {
      _id: `${msg.collectionId}:${msg.creator}`,
      _rev: undefined,
      balances: [],
      cosmosAddress: msg.creator,
      collectionId: msg.collectionId,
      onChain: true,
      approvedOutgoingTransfers: collectionDoc.defaultUserApprovedOutgoingTransfers,
      approvedIncomingTransfers: collectionDoc.defaultUserApprovedIncomingTransfers,
      userPermissions: collectionDoc.defaultUserPermissions,
      updateHistory: [],
    }
  }

  balancesDoc.updateHistory.push({
    block: status.block.height,
    blockTimestamp: status.block.timestamp,
    txHash: txHash,
  });


  if (msg.updateApprovedIncomingTransfers) {
    balancesDoc.approvedIncomingTransfers = msg.approvedIncomingTransfers;
  }

  if (msg.updateApprovedOutgoingTransfers) {
    balancesDoc.approvedOutgoingTransfers = msg.approvedOutgoingTransfers;
  }

  if (msg.updateUserPermissions) {
    balancesDoc.userPermissions = msg.userPermissions;
  }

  docs.balances[`${msg.collectionId}:${msg.creator}`] = balancesDoc;

  // console.log("BALANCES DOC", `${msg.collectionId}:${msg.creator}`, JSON.stringify(docs.balances[`${msg.collectionId}:${msg.creator}`], null, 2));
}