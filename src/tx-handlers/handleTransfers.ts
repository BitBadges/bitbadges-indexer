import { Transfer } from "bitbadgesjs-proto";
import { Collection, DbStatus, DocsCache, TransferActivityItem, addBalancesForIdRanges, getBalancesAfterTransfers } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/db";
;

export const handleTransfers = async (collection: Collection, from: (string | 'Mint')[], transfers: Transfer[], docs: DocsCache, status: DbStatus) => {
  //Handle new acocunts, if empty 
  for (const address of from) {
    if (address === 'Mint') continue;

    await fetchDocsForCacheIfEmpty(docs, [], [], [], [`${collection.collectionId}:${address}`], []);
  }

  for (const transfer of transfers) {
    await fetchDocsForCacheIfEmpty(docs, [], [], [], [
      ...transfer.toAddresses.map((address) => `${collection.collectionId}:${address}`),
    ], []);
  }


  //For each transfer, 1) calculate new balances of the toAddresses and 2) add to activity (each as separate transfer)
  for (let idx = 0; idx < transfers.length; idx++) {
    const transfer = transfers[idx];
    for (let j = 0; j < transfer.toAddresses.length; j++) {
      const address = transfer.toAddresses[j];

      let currBalance = docs.balances[`${collection.collectionId}:${address}`];
      for (const transferBalanceObj of transfer.balances) {
        currBalance = {
          ...currBalance,
          ...addBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.amount),
          cosmosAddress: address,
        };
      }
    }

    docs.activityToAdd.push({
      partition: `collection-${collection.collectionId}`,
      from: from,
      to: transfer.toAddresses,
      balances: transfer.balances,
      method: JSON.stringify(from) === JSON.stringify(['Mint']) ? 'Mint' : 'Transfer',
      block: status.block.height,
      collectionId: collection.collectionId,
      timestamp: BigInt(Date.now()),
    } as TransferActivityItem);
  }

  for (const fromAddress of from) {
    if (fromAddress === 'Mint') continue;


    let fromAddressBalanceDoc = docs.balances[`${collection.collectionId}:${fromAddress}`];
    fromAddressBalanceDoc = {
      ...fromAddressBalanceDoc,
      ...getBalancesAfterTransfers(fromAddressBalanceDoc.balances, transfers),
      cosmosAddress: fromAddress,
    }
  }
}

