import { Transfer } from "bitbadgesjs-proto";
import { BalanceDoc, BitBadgesCollection, CollectionDoc, DocsCache, StatusDoc, addBalances, getBlankBalance, subtractBalances } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/cache";

export const handleTransfers = async (collection: CollectionDoc<bigint> | BitBadgesCollection<bigint>, transfers: Transfer<bigint>[], docs: DocsCache, status: StatusDoc<bigint>, creator: string, fromEvent?: boolean) => {
  
  
  //Handle new acocunts, if empty 
  for (const transfer of transfers) {
    await fetchDocsForCacheIfEmpty(docs, [], [], [`${collection.collectionId}:${transfer.from}`], [], [], []);

    await fetchDocsForCacheIfEmpty(docs, [], [], [
      ...transfer.toAddresses.map((address) => `${collection.collectionId}:${address}`),
    ], [], [], []);
  }



  //For each transfer, 1) calculate new balances of the toAddresses and 2) add to activity (each as separate transfer)
  for (let idx = 0; idx < transfers.length; idx++) {
    const transfer = transfers[idx];

    if (transfer.precalculationDetails && !fromEvent && transfer.precalculationDetails.approvalId) {
      continue //We process these with the end block events
    }

    for (let j = 0; j < transfer.toAddresses.length; j++) {
      const address = transfer.toAddresses[j];
      const balanceDoc = docs.balances[`${collection.collectionId}:${address}`];
      let currBalance: BalanceDoc<bigint> = balanceDoc ? balanceDoc :
        {
          ...getBlankBalance(true, collection),
          approvedIncomingTransfersTimeline: [],
          approvedOutgoingTransfersTimeline: [],
          cosmosAddress: address,
          collectionId: collection.collectionId,
          onChain: collection.balancesType === 'Standard',
          _id: `${collection.collectionId}:${address}`,
          _rev: undefined,
        };

      currBalance = {
        ...currBalance,
        balances: addBalances(transfer.balances, currBalance.balances),
        cosmosAddress: address,
      };

      docs.balances[`${collection.collectionId}:${address}`] = currBalance;
    }

    const fromBalanceDoc = docs.balances[`${collection.collectionId}:${transfer.from}`];
    let fromAddressBalanceDoc: BalanceDoc<bigint> = fromBalanceDoc ? fromBalanceDoc :
      {
        ...getBlankBalance(true, collection),
        approvedIncomingTransfersTimeline: [],
        approvedOutgoingTransfersTimeline: [],
        cosmosAddress: transfer.from,
        collectionId: collection.collectionId,
        onChain: collection.balancesType === 'Standard',
        _id: `${collection.collectionId}:${transfer.from}`,
        _rev: undefined,
      };

    fromAddressBalanceDoc = {
      ...fromAddressBalanceDoc,
      balances: subtractBalances(transfer.balances, fromAddressBalanceDoc.balances),
      cosmosAddress: transfer.from,
    }

    docs.balances[`${collection.collectionId}:${transfer.from}`] = fromAddressBalanceDoc;

    docs.activityToAdd.push({
      _id: `collection-${collection.collectionId}:${status.block.height}-${status.block.txIndex}-${idx}`,
      from: transfer.from,
      to: transfer.toAddresses,
      balances: transfer.balances,
      method: 'Transfer',
      block: status.block.height,
      collectionId: collection.collectionId,
      timestamp: BigInt(Date.now()),
      memo: transfer.memo,
      precalculationDetails: transfer.precalculationDetails,
      initiatedBy: creator
    });
  }
}

