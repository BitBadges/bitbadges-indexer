import { MessageMsgUpdateAllowedTransfers } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";



export const handleMsgUpdateDisallowedTransfers = async (msg: MessageMsgUpdateAllowedTransfers, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);
  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.allowedTransfers = msg.allowedTransfers;
}