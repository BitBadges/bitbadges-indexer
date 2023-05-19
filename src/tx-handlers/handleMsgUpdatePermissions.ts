import { MessageMsgUpdatePermissions } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, DocsCache, GetPermissions, Collection } from "bitbadgesjs-utils";
import nano from "nano";

export const handleMsgUpdatePermissions = async (msg: MessageMsgUpdatePermissions, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because Msg can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.permissions = GetPermissions(msg.permissions)
}