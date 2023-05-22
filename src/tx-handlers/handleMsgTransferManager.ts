import { MessageMsgTransferManager } from "bitbadgesjs-transactions";
import { DbStatus, DocsCache, Collection } from "bitbadgesjs-utils";
import nano from "nano";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccountByAddress } from "./handleNewAccount";
;

export const handleMsgTransferManager = async (msg: MessageMsgTransferManager, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForRequestIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgTransferBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.manager = msg.address;
  collectionDoc.managerRequests = collectionDoc.managerRequests.filter((address: string) => address !== msg.address);
}