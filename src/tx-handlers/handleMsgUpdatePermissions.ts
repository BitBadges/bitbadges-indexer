import { MsgUpdatePermissions } from "bitbadgesjs-transactions";
import { fetchDocsForCacheIfEmpty } from "../db/cache";

import { DocsCache, GetPermissions, StatusDoc } from "bitbadgesjs-utils";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgUpdatePermissions = async (msg: MsgUpdatePermissions<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because Msg can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);

  collectionDoc.permissions = GetPermissions(msg.permissions)
}