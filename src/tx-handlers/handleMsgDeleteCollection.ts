import { MsgDeleteCollection } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"
import { ApprovalsTrackerModel, BalanceModel, CollectionModel, MerkleChallengeModel, deleteMany } from "../db/db"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"
import mongoose from "mongoose"

export const handleMsgDeleteCollection = async (msg: MsgDeleteCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache, session: mongoose.ClientSession): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);
  await deleteMany(CollectionModel, [collectionDoc.collectionId.toString()]);
  delete docs.collections[msg.collectionId.toString()];

  //Delete all relevant docs from DB
  const allBalancesDocs = await BalanceModel.find({
    collectionId: msg.collectionId.toString(),
  }).lean().session(session).exec();

  const allMerkleChallengesDocs = await MerkleChallengeModel.find({
    collectionId: msg.collectionId.toString(),
  }).lean().session(session).exec();

  const allApprovalDocs = await ApprovalsTrackerModel.find({
    collectionId: msg.collectionId.toString(),
  }).lean().session(session).exec();

  const promises = [];
  promises.push(deleteMany(BalanceModel, allBalancesDocs.map((doc) => doc._legacyId), session));
  promises.push(deleteMany(MerkleChallengeModel, allMerkleChallengesDocs.map((doc) => doc._legacyId), session))
  promises.push(deleteMany(ApprovalsTrackerModel, allApprovalDocs.map((doc) => doc._legacyId), session))

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