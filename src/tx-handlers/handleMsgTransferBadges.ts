import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"

import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"
import { MsgTransferBadges } from "bitbadgesjs-proto"

export const handleMsgTransferBadges = async (msg: MsgTransferBadges<bigint>, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  const collectionIdString = `${msg.collectionId}`

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[collectionIdString];
  if (!collectionDoc) throw new Error(`Collection ${collectionIdString} does not exist`);

  await handleTransfers(collectionDoc, msg.transfers, docs, status, msg.creator, txHash);
}