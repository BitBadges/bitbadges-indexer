import { MessageMsgUpdatePermissions } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"

import { DbStatus, DocsCache, GetPermissions, Collection } from "bitbadgesjs-utils";
import nano from "nano";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgUpdatePermissions = async (msg: MessageMsgUpdatePermissions, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForRequestIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because Msg can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.permissions = GetPermissions(msg.permissions)
}