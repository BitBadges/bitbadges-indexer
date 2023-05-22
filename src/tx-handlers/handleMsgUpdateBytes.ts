import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions";
import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
;
import { updateBalancesForOffChainBalances } from "./offChainBalances";
import nano from "nano";
import { handleNewAccountByAddress } from "./handleNewAccount";


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForRequestIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgUpdateBytes can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;

  collectionDoc.bytes = msg.bytes;

  await updateBalancesForOffChainBalances(collectionDoc, docs, false);
}