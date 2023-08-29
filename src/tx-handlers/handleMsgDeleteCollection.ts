import { MsgDeleteCollection } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { APPROVALS_TRACKER_DB, BALANCES_DB, MERKLE_CHALLENGES_DB } from "../db/db"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgDeleteCollection = async (msg: MsgDeleteCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);
  collectionDoc._deleted = true;

  //Delete all relevant docs from DB
  const allBalancesDocs = await BALANCES_DB.partitionedList(`${msg.collectionId.toString()}`);
  const allMerkleChallengesDocs = await MERKLE_CHALLENGES_DB.partitionedList(`${msg.collectionId.toString()}`);
  const allApprovalDocs = await APPROVALS_TRACKER_DB.partitionedList(`${msg.collectionId.toString()}`);

  const promises = [];
  for (const doc of allBalancesDocs.rows) {
    promises.push(BALANCES_DB.destroy(doc.id, doc.value.rev));
  }
  for (const doc of allMerkleChallengesDocs.rows) {
    promises.push(MERKLE_CHALLENGES_DB.destroy(doc.id, doc.value.rev));
  }

  for (const doc of allApprovalDocs.rows) {
    promises.push(APPROVALS_TRACKER_DB.destroy(doc.id, doc.value.rev));
  }

  await Promise.all(promises);

  for (const key of Object.keys(docs.balances)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.balances[key];
    }
  }

  for (const key of Object.keys(docs.merkleChallenges)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.merkleChallenges[key];
    }
  }

  for (const key of Object.keys(docs.approvalsTrackers)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.approvalsTrackers[key];
    }
  }
}