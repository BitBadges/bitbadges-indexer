import { MessageMsgRequestTransferManager } from "bitbadgesjs-transactions";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccountByAddress } from "./handleNewAccount";
import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";

export const handleMsgRequestTransferManager = async (msg: MessageMsgRequestTransferManager, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  const add = msg.addRequest;
  if (add) {
    collectionDoc.managerRequests = [...collectionDoc.managerRequests, msg.creator];
  } else {
    collectionDoc.managerRequests = collectionDoc.managerRequests.filter((address: string) => address !== msg.creator);
  }
}