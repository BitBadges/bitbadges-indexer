import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils"
import { MessageMsgTransferBadge } from "bitbadgesjs-transactions"
import { fetchDocsForCacheIfEmpty } from "../db/db"

import { handleTransfers } from "./handleTransfers"
import nano from "nano"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgTransferBadge = async (msg: MessageMsgTransferBadge, status: DbStatus, docs: DocsCache): Promise<void> => {
  const collectionIdString = `${msg.collectionId}`

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[collectionIdString] as Collection & nano.DocumentGetResponse;

  await handleTransfers(collectionDoc, [msg.from], msg.transfers, docs, status);
}