import { type MsgUpdateUserApprovals, type StatusDoc, UpdateHistory, UserPermissions, BalanceDoc } from 'bitbadgesjs-sdk';
import { fetchDocsForCacheIfEmpty } from '../db/cache';

import { handleNewAccountByAddress } from './handleNewAccount';
import { recursivelyDeleteFalseProperties } from './handleMsgUniversalUpdateCollection';
import { type DocsCache } from '../db/types';
import { handleUserApprovals } from './approvalInfo';

export const handleMsgUpdateUserApprovals = async (
  msg: MsgUpdateUserApprovals<bigint>,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  txHash: string
): Promise<void> => {
  recursivelyDeleteFalseProperties(msg);

  await fetchDocsForCacheIfEmpty(docs, [], [msg.collectionId], [`${msg.collectionId}:${msg.creator}`], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  const collectionDoc = docs.collections[`${msg.collectionId}`];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId} does not exist`);

  let balancesDoc = docs.balances[`${msg.collectionId}:${msg.creator}`];
  if (!balancesDoc) {
    balancesDoc = new BalanceDoc<bigint>({
      _docId: `${msg.collectionId}:${msg.creator}`,
      balances: collectionDoc.defaultBalances.balances,
      cosmosAddress: msg.creator,
      collectionId: msg.collectionId,
      onChain: true,
      outgoingApprovals: collectionDoc.defaultBalances.outgoingApprovals,
      incomingApprovals: collectionDoc.defaultBalances.incomingApprovals,
      autoApproveSelfInitiatedIncomingTransfers: collectionDoc.defaultBalances.autoApproveSelfInitiatedIncomingTransfers,
      autoApproveSelfInitiatedOutgoingTransfers: collectionDoc.defaultBalances.autoApproveSelfInitiatedOutgoingTransfers,
      userPermissions: collectionDoc.defaultBalances.userPermissions,
      updateHistory: []
    });
  }
  if (!balancesDoc) throw new Error(`Balance ${msg.collectionId}:${msg.creator} does not exist`); // For TS

  balancesDoc.updateHistory.push(
    new UpdateHistory({
      block: status.block.height,
      blockTimestamp: status.block.timestamp,
      txHash,
      timestamp: 0n
    })
  );

  if (msg.updateIncomingApprovals) {
    balancesDoc.incomingApprovals = msg.incomingApprovals ?? [];
  }

  if (msg.updateOutgoingApprovals) {
    balancesDoc.outgoingApprovals = msg.outgoingApprovals ?? [];
  }

  await handleUserApprovals(docs, status, msg);

  if (msg.updateUserPermissions) {
    balancesDoc.userPermissions = msg.userPermissions ?? UserPermissions.InitEmpty();
  }

  docs.balances[`${msg.collectionId}:${msg.creator}`] = balancesDoc;
};
