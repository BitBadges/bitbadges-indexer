import { MsgDeleteCollection } from "bitbadgesjs-transactions"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { BALANCES_DB, CLAIMS_DB } from "../db/db"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgDeleteCollection = async (msg: MsgDeleteCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);
  collectionDoc._deleted = true;

  //Delete all relevant docs from DB
  const allBalancesDocs = await BALANCES_DB.partitionedList(`${msg.collectionId.toString()}`);
  const allClaimsDocs = await CLAIMS_DB.partitionedList(`${msg.collectionId.toString()}`);

  const promises = [];
  for (const doc of allBalancesDocs.rows) {
    promises.push(BALANCES_DB.destroy(doc.id, doc.value.rev));
  }
  for (const doc of allClaimsDocs.rows) {
    promises.push(CLAIMS_DB.destroy(doc.id, doc.value.rev));
  }

  await Promise.all(promises);

  for (const key of Object.keys(docs.balances)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.balances[key];
    }
  }

  for (const key of Object.keys(docs.claims)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.claims[key];
    }
  }
}