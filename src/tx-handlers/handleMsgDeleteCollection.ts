import { Collection, DbStatus, DocsCache } from "bitbadgesjs-utils"
import { MessageMsgDeleteCollection } from "bitbadgesjs-transactions"
import { BALANCES_DB, CLAIMS_DB, METADATA_DB, fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import nano from "nano"

export const handleMsgDeleteCollection = async (msg: MessageMsgDeleteCollection, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);


  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()] as Collection & nano.DocumentGetResponse;
  collectionDoc._deleted = true;

  //Delete all relevant docs from DB
  const allMetadataDocs = await METADATA_DB.partitionedList(`${msg.collectionId.toString()}`);
  const allBalancesDocs = await BALANCES_DB.partitionedList(`${msg.collectionId.toString()}`);
  const allClaimsDocs = await CLAIMS_DB.partitionedList(`${msg.collectionId.toString()}`);

  const promises = [];
  for (const doc of allMetadataDocs.rows) {
    promises.push(METADATA_DB.destroy(doc.id, doc.value.rev));
  }
  for (const doc of allBalancesDocs.rows) {
    promises.push(BALANCES_DB.destroy(doc.id, doc.value.rev));
  }
  for (const doc of allClaimsDocs.rows) {
    promises.push(CLAIMS_DB.destroy(doc.id, doc.value.rev));
  }

  await Promise.all(promises);

  //Delete all metadata docs from docs object (safe to do because no TXs will be processed after this delete one)
  for (const key of Object.keys(docs.metadata)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.metadata[key];
    }
  }

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