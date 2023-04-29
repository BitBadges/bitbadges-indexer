import { ActivityItem, AddBalancesForIdRanges, DbStatus, Docs, StoredBadgeCollection, Transfers, getBalanceAfterTransfers } from "bitbadgesjs-utils";
import { handleNewAccount } from "./handleNewAccount";
import { nanoid } from "nanoid";



export const handleTransfers = async (collection: StoredBadgeCollection, from: (number | 'Mint')[], transfers: Transfers[], docs: Docs, status: DbStatus) => {
    //Handle new acocunts, if empty 
    for (const address of from) {
        if (address === 'Mint') continue;

        docs = await handleNewAccount(Number(address), docs);
    }

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            docs = await handleNewAccount(Number(address), docs);
        }
    }


    //Calculate new balances of the toAddresses
    for (let idx = 0; idx < transfers.length; idx++) {
        const transfer = transfers[idx];
        for (let j = 0; j < transfer.toAddresses.length; j++) {
            const address = transfer.toAddresses[j];

            //currBalance is used as a UserBalance type to be compatible with AddBalancesForIdRanges
            const currBalance = docs.collections[collection.collectionId].balances[address]
                ? docs.collections[collection.collectionId].balances[address]
                : { balances: [], approvals: [] };

            for (const transferBalanceObj of transfer.balances) {
                docs.collections[collection.collectionId].balances[address] = AddBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.balance);
            }
        }

        docs.activityToAdd.push({
            _id: `${docs.collections[collection.collectionId].collectionId}:${nanoid(64)}`,
            from: from,
            to: transfer.toAddresses,
            balances: transfer.balances,
            method: JSON.stringify(from) === JSON.stringify(['Mint']) ? 'Mint' : 'Transfer',
            block: status.block.height,
            collectionId: docs.collections[collection.collectionId].collectionId,
            timestamp: Date.now(),
            users: transfer.toAddresses.map((address) => {
                return { start: address, end: address }
            }),
        } as ActivityItem);
    }

    for (const fromAddress of from) {
        if (fromAddress === 'Mint') continue;

        //Deduct balances from the fromAddress
        collection.balances[fromAddress] = getBalanceAfterTransfers(
            {
                balances: collection.balances[fromAddress].balances,
                approvals: [],
            },
            transfers
        );
    }

    return docs;
}

  