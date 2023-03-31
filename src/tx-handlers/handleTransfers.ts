import { BadgeCollection, Transfers, Docs, AddBalancesForIdRanges } from "bitbadges-sdk";

export const handleTransfers = async (collection: BadgeCollection, transfers: Transfers[], docs: Docs) => {
    for (let idx = 0; idx < transfers.length; idx++) {
        let transfer = transfers[idx];
        for (let j = 0; j < transfer.toAddresses.length; j++) {
            let address = transfer.toAddresses[j];

            let currBalance = docs.collections[collection.collectionId].balances[address]
                ? docs.collections[collection.collectionId].balances[address]
                : {
                    balances: [],
                    approvals: [],
                };

            for (const transferBalanceObj of transfer.balances) {
                docs.collections[collection.collectionId].balances[address] = AddBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.balance);
            }
        }

        docs.collections[collection.collectionId].activity.push({
            from: ['Mint'],
            to: transfer.toAddresses,
            balances: transfer.balances,
            method: 'Mint',
        });
    }

    return docs;
}