import { MessageMsgUpdateDisallowedTransfers } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { CollectionDocument, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";



export const handleMsgUpdateDisallowedTransfers = async (msg: MessageMsgUpdateDisallowedTransfers, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);
  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;

  collectionDoc.disallowedTransfers = msg.disallowedTransfers;
}