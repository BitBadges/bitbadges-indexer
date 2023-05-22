import { MessageMsgUpdateAllowedTransfers } from "bitbadgesjs-transactions"
import { fetchDocsForCacheIfEmpty } from "../db/db"

import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";
import { handleNewAccountByAddress } from "./handleNewAccount";



export const handleMsgUpdateAllowedTransfers = async (msg: MessageMsgUpdateAllowedTransfers, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.allowedTransfers = msg.allowedTransfers;
}