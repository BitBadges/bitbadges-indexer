import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions";
import { CollectionDocument, DbStatus, DocsCache } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccountByAddress } from "./handleNewAccount";
import { updateBalancesForOffChainBalances } from "./offChainBalances";
import nano from "nano";


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);
  //Safe to cast because MsgUpdateBytes can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;

  collectionDoc.bytes = msg.newBytes;

  await updateBalancesForOffChainBalances(collectionDoc, docs, false);
}