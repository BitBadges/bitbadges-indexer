import { Transfers } from "bitbadgesjs-proto";
import { CollectionDocument, DbStatus, DocsCache, TransferActivityItem, addBalancesForIdRanges, getBalanceAfterTransfers } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { handleNewAccount } from "./handleNewAccount";

export const handleTransfers = async (collection: CollectionDocument, from: (number | 'Mint')[], transfers: Transfers[], docs: DocsCache, status: DbStatus) => {
  //Handle new acocunts, if empty 
  for (const address of from) {
    if (address === 'Mint') continue;

    await handleNewAccount(Number(address), docs);

    const [cosmosAddress, accountNumber] = Object.entries(docs.accountNumbersMap).find(([key, value]) => value === address) ?? [undefined, undefined];
    if (cosmosAddress === undefined || accountNumber === undefined) {
      throw new Error("Cosmos address or account number not found");
    }

    await fetchDocsForRequestIfEmpty(docs, [], [], [], [`${collection.collectionId}:${cosmosAddress}`], []);
  }

  for (const transfer of transfers) {
    for (const address of transfer.toAddresses) {
      await handleNewAccount(Number(address), docs);
    }

    await fetchDocsForRequestIfEmpty(docs, [], [], [], [
      ...transfer.toAddresses.map((address) => {
        const [cosmosAddress, accountNumber] = Object.entries(docs.accountNumbersMap).find(([key, value]) => value === address) ?? [undefined, undefined];
        if (cosmosAddress === undefined || accountNumber === undefined) {
          throw new Error("Cosmos address or account number not found");
        }
        return `${collection.collectionId}:${cosmosAddress}`
      })
    ], []);
  }


  //For each transfer, 1) calculate new balances of the toAddresses and 2) add to activity (each as separate transfer)
  for (let idx = 0; idx < transfers.length; idx++) {
    const transfer = transfers[idx];
    for (let j = 0; j < transfer.toAddresses.length; j++) {
      const address = transfer.toAddresses[j];

      const [cosmosAddress, accountNumber] = Object.entries(docs.accountNumbersMap).find(([key, value]) => value === address) ?? [undefined, undefined];
      if (cosmosAddress === undefined || accountNumber === undefined) {
        throw new Error("Cosmos address or account number not found");
      }

      let currBalance = docs.balances[`${collection.collectionId}:${cosmosAddress}`];
      for (const transferBalanceObj of transfer.balances) {
        currBalance = {
          ...currBalance,
          ...addBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.balance),
          cosmosAddress: cosmosAddress,
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
      timestamp: Date.now(),
    } as TransferActivityItem);
  }


  for (const fromAddress of from) {
    if (fromAddress === 'Mint') continue;

    //Deduct balances from the fromAddress
    const [cosmosAddress, accountNumber] = Object.entries(docs.accountNumbersMap).find(([key, value]) => value === fromAddress) ?? [undefined, undefined];
    if (cosmosAddress === undefined || accountNumber === undefined) {
      throw new Error("Cosmos address or account number not found");
    }

    let fromAddressBalanceDoc = docs.balances[`${collection.collectionId}:${cosmosAddress}`];
    fromAddressBalanceDoc = {
      ...fromAddressBalanceDoc,
      ...getBalanceAfterTransfers(
        {
          balances: fromAddressBalanceDoc.balances,
          approvals: [],
        },
        transfers
      ),
      cosmosAddress: cosmosAddress,
    }
  }
}

