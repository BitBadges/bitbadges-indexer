import { MsgRequestTransferManager } from "bitbadgesjs-transactions";
import { DocsCache, StatusDoc } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/cache";
import { handleNewAccountByAddress } from "./handleNewAccount";
;

export const handleMsgRequestTransferManager = async (msg: MsgRequestTransferManager<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);

  const add = msg.addRequest;
  if (add) {
    collectionDoc.managerRequests = [...collectionDoc.managerRequests, msg.creator];
  } else {
    collectionDoc.managerRequests = collectionDoc.managerRequests.filter((address: string) => address !== msg.creator);
  }
}