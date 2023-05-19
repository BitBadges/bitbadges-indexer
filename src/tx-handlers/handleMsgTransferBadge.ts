import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils"
import { MessageMsgTransferBadge } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"
import nano from "nano"

export const handleMsgTransferBadge = async (msg: MessageMsgTransferBadge, status: DbStatus, docs: DocsCache): Promise<void> => {
  const collectionIdString = `${msg.collectionId}`

  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[collectionIdString] as Collection & nano.DocumentGetResponse;

  await handleTransfers(collectionDoc, [Number(msg.from)], msg.transfers, docs, status);
}