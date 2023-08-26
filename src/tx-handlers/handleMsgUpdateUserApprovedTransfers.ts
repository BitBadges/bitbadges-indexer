import { MsgUpdateUserApprovedTransfers } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"

import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgUpdateUserApprovedTransfers = async (msg: MsgUpdateUserApprovedTransfers<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  console.log(JSON.stringify(msg, null, 2));
  await fetchDocsForCacheIfEmpty(docs, [], [msg.collectionId], [
    `${msg.collectionId}:${msg.creator}`,
  ], [], [], []);
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
      approvedOutgoingTransfersTimeline: collectionDoc.defaultUserApprovedOutgoingTransfersTimeline,
      approvedIncomingTransfersTimeline: collectionDoc.defaultUserApprovedIncomingTransfersTimeline,
      userPermissions: collectionDoc.defaultUserPermissions,
    }
  }

  if (msg.updateApprovedIncomingTransfersTimeline) {
    balancesDoc.approvedIncomingTransfersTimeline = msg.approvedIncomingTransfersTimeline;
  }

  if (msg.updateApprovedOutgoingTransfersTimeline) {
    balancesDoc.approvedOutgoingTransfersTimeline = msg.approvedOutgoingTransfersTimeline;
  }

  if (msg.updateUserPermissions) {
    balancesDoc.userPermissions = msg.userPermissions;
  }

  docs.balances[`${msg.collectionId}:${msg.creator}`] = balancesDoc;

  console.log("BALANCES DOC", `${msg.collectionId}:${msg.creator}`, JSON.stringify(docs.balances[`${msg.collectionId}:${msg.creator}`], null, 2));
}