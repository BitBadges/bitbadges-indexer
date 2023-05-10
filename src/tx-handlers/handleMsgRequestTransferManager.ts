import { MessageMsgRequestTransferManager } from "bitbadgesjs-transactions";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccountByAddress } from "./handleNewAccount";
import { CollectionDocument, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";

export const handleMsgRequestTransferManager = async (msg: MessageMsgRequestTransferManager, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;

  const creatorNum = docs.accountNumbersMap[msg.creator];
  if (creatorNum === undefined) {
    throw new Error("Creator account number not found");
  }

  const add = msg.addRequest;
  if (add) {
    collectionDoc.managerRequests = [...collectionDoc.managerRequests, creatorNum];
  } else {
    collectionDoc.managerRequests = collectionDoc.managerRequests.filter((address: number) => address !== creatorNum);
  }
}