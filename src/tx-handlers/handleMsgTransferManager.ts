import { MessageMsgTransferManager } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccount, handleNewAccountByAddress } from "./handleNewAccount"
import { CollectionDocument, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";

export const handleMsgTransferManager = async (msg: MessageMsgTransferManager, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await handleNewAccount(msg.address, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;

  collectionDoc.manager = msg.address;
  collectionDoc.managerRequests = collectionDoc.managerRequests.filter((address: number) => Number(address) !== Number(msg.address));
}