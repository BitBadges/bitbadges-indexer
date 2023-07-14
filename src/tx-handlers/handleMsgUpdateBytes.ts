import { MsgUpdateBytes } from "bitbadgesjs-transactions";
import { DocsCache, StatusDoc } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/cache";
import { handleNewAccountByAddress } from "./handleNewAccount";
;


export const handleMsgUpdateBytes = async (msg: MsgUpdateBytes<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgUpdateBytes can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);

  collectionDoc.bytes = msg.bytes;
}