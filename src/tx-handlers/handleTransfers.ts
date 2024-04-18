import { BalanceDoc, TransferActivityDoc, type BitBadgesCollection, type CollectionDoc, type StatusDoc, type Transfer } from 'bitbadgesjs-sdk';
import { fetchDocsForCacheIfEmpty } from '../db/cache';
import { type DocsCache } from '../db/types';

export const handleTransfers = async (
  collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>,
  transfers: Array<Transfer<bigint>>,
  docs: DocsCache,
  status: StatusDoc<bigint>,
  creator: string,
  txHash?: string,
  fromEvent?: boolean
) => {
  // Handle new acocunts, if empty
  for (const transfer of transfers) {
    await fetchDocsForCacheIfEmpty(
      docs,
      [],
      [],
      [`${collection.collectionId}:${transfer.from}`, ...transfer.toAddresses.map((address) => `${collection.collectionId}:${address}`)],
      [],
      [],
      [],
      [],
      []
    );
  }

  // For each transfer, 1) calculate new balances of the toAddresses and 2) add to activity (each as separate transfer)
  for (let idx = 0; idx < transfers.length; idx++) {
    const transfer = transfers[idx];
    if (transfer.precalculateBalancesFromApproval && !fromEvent && transfer.precalculateBalancesFromApproval.approvalId) {
      continue; // We process these with the end block events
    }

    for (let j = 0; j < transfer.toAddresses.length; j++) {
      const address = transfer.toAddresses[j];
      const balanceDoc = docs.balances[`${collection.collectionId}:${address}`];

      const currBalance =
        balanceDoc ??
        new BalanceDoc({
          ...collection.defaultBalances.clone(),
          cosmosAddress: address,
          collectionId: collection.collectionId,
          onChain: collection.balancesType === 'Standard',
          _docId: `${collection.collectionId}:${address}`,
          updateHistory: []
        });
      currBalance.balances.addBalances(transfer.balances);
      docs.balances[`${collection.collectionId}:${address}`] = currBalance;
    }

    const fromBalanceDoc = docs.balances[`${collection.collectionId}:${transfer.from}`];
    const fromAddressBalanceDoc: BalanceDoc<bigint> =
      fromBalanceDoc ??
      new BalanceDoc({
        ...collection.defaultBalances.clone(),
        cosmosAddress: transfer.from,
        collectionId: collection.collectionId,
        onChain: collection.balancesType === 'Standard',
        _docId: `${collection.collectionId}:${transfer.from}`,
        updateHistory: []
      });
    fromAddressBalanceDoc.balances.subtractBalances(transfer.balances, false);

    docs.activityToAdd.push(
      new TransferActivityDoc<bigint>({
        _docId: `collection-${collection.collectionId}:${status.block.height}-${status.block.txIndex}-${idx}`,
        from: transfer.from,
        to: transfer.toAddresses,
        balances: transfer.balances,
        block: status.block.height,
        collectionId: collection.collectionId,
        timestamp: status.block.timestamp,
        memo: transfer.memo,
        precalculateBalancesFromApproval: transfer.precalculateBalancesFromApproval,
        prioritizedApprovals: transfer.prioritizedApprovals,
        onlyCheckPrioritizedApprovals: transfer.onlyCheckPrioritizedApprovals,
        initiatedBy: creator,
        txHash
      })
    );
  }
};
