import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions";
import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccountByAddress } from "./handleNewAccount";
import { updateBalancesForOffChainBalances } from "./offChainBalances";
import nano from "nano";


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);
  //Safe to cast because MsgUpdateBytes can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.bytes = msg.bytes;

  await updateBalancesForOffChainBalances(collectionDoc, docs, false);
}