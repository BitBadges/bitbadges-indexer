import { type MsgDeleteCollection, type StatusDoc } from 'bitbadgesjs-sdk';

import type mongoose from 'mongoose';
import { deleteMany } from '../db/db';
import { ApprovalTrackerModel, BalanceModel, CollectionModel, MerkleChallengeModel } from '../db/schemas';
import { fetchDocsForCacheIfEmpty } from '../db/cache';
import { type DocsCache } from '../db/types';
import { handleNewAccountByAddress } from './handleNewAccount';
import { findInDB } from '../db/queries';

export const handleMsgDeleteCollection = async (
  msg: MsgDeleteCollection<bigint>,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  session: mongoose.ClientSession
): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  // Safe to cast because MsgDeleteCollection can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);
  await deleteMany(CollectionModel, [collectionDoc.collectionId.toString()]);
  delete docs.collections[msg.collectionId.toString()];

  // Delete all relevant docs from DB
  const allBalancesDocs = await findInDB(BalanceModel, {
    query: { collectionId: msg.collectionId.toString() },
    session
  });
  const allMerkleChallengesDocs = await findInDB(MerkleChallengeModel, {
    query: { collectionId: msg.collectionId.toString() },
    session
  });
  const allApprovalDocs = await findInDB(ApprovalTrackerModel, {
    query: { collectionId: msg.collectionId.toString() },
    session
  });

  const promises = [];
  promises.push(
    deleteMany(
      BalanceModel,
      allBalancesDocs.map((doc) => doc._docId),
      session
    )
  );
  promises.push(
    deleteMany(
      MerkleChallengeModel,
      allMerkleChallengesDocs.map((doc) => doc._docId),
      session
    )
  );
  promises.push(
    deleteMany(
      ApprovalTrackerModel,
      allApprovalDocs.map((doc) => doc._docId),
      session
    )
  );

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

  for (const key of Object.keys(docs.approvalTrackers)) {
    if (key.split(':')[0] === `${msg.collectionId}`) {
      delete docs.approvalTrackers[key];
    }
  }
};
