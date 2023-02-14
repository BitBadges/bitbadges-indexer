import { SHA256 } from "crypto-js";
import { MerkleTree } from "merkletreejs";
import { BadgeCollection, DistributionMethod, Transfers } from "../types";

export function cleanBadgeCollection(collection: BadgeCollection) {
    collection.collectionId = collection.collectionId ? Number(collection.collectionId) : 0;
    collection.nextBadgeId = collection.nextBadgeId ? Number(collection.nextBadgeId) : 0;
    collection.standard = collection.standard ? Number(collection.standard) : 0;
    collection.permissions = collection.permissions ? Number(collection.permissions) : 0;
    collection.unmintedSupplys = collection.unmintedSupplys ? collection.unmintedSupplys : [];
    collection.maxSupplys = collection.maxSupplys ? collection.maxSupplys : [];
    collection.claims = collection.claims ? collection.claims : [];
    collection.disallowedTransfers = collection.disallowedTransfers ? collection.disallowedTransfers : [];
    collection.managerApprovedTransfers = collection.managerApprovedTransfers ? collection.managerApprovedTransfers : [];
    collection.collectionUri = collection.collectionUri ? collection.collectionUri : ""
    collection.badgeUri = collection.badgeUri ? collection.badgeUri : ""
    collection.bytes = collection.bytes ? collection.bytes : ""
    collection.manager = collection.manager ? Number(collection.manager) : 0;

    collection.disallowedTransfers = collection.disallowedTransfers.map((transfer) => {
        return {
            to: {
                accountNums: transfer.to.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }),
                options: Number(transfer.to.options)
            },
            from: {
                accountNums: transfer.from.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }),
                options: Number(transfer.from.options)
            }
        }
    });

    collection.managerApprovedTransfers = collection.managerApprovedTransfers.map((transfer) => {
        return {
            to: {
                accountNums: transfer.to.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }),
                options: Number(transfer.to.options)
            },
            from: {
                accountNums: transfer.from.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }),
                options: Number(transfer.from.options)
            }
        }
    });

    collection.claims = collection.claims.map((claim) => {
        return {
            balances: claim.balances.map((balance) => {
                return {
                    balance: balance.balance ? Number(balance.balance) : 0,
                    badgeIds: balance.badgeIds.map((id) => {
                        return {
                            start: id.start ? Number(id.start) : 0,
                            end: id.end ? Number(id.end) : 0
                        }
                    })
                }
            }),
            badgeIds: claim.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }),
            incrementIdsBy: claim.incrementIdsBy ? Number(claim.incrementIdsBy) : 0,
            amountPerClaim: claim.amountPerClaim ? Number(claim.amountPerClaim) : 0,
            type: claim.type ? Number(claim.type) : 0,
            data: claim.data ? claim.data : "",
            uri: claim.uri ? claim.uri : "",
            timeRange: {
                start: claim.timeRange.start ? Number(claim.timeRange.start) : 0,
                end: claim.timeRange.end ? Number(claim.timeRange.end) : 0
            },
            leaves: [],
            tree: new MerkleTree([], SHA256),
            distributionMethod: DistributionMethod.None
        }
    });



    collection.unmintedSupplys = collection.unmintedSupplys.map((supply) => {
        return {
            balance: supply.balance ? Number(supply.balance) : 0,
            badgeIds: supply.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }),
        }
    });

    collection.maxSupplys = collection.maxSupplys.map((supply) => {
        return {
            balance: supply.balance ? Number(supply.balance) : 0,
            badgeIds: supply.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }),
        }
    });

    return collection;
}

export function cleanTransfers(transfers: Transfers[]) {
    transfers = transfers.map((transfer) => {
        return {
            toAddresses: transfer.toAddresses ? transfer.toAddresses : [],
            balances: transfer.balances.map((supply) => {
                return {
                    balance: supply.balance ? Number(supply.balance) : 0,
                    badgeIds: supply.badgeIds.map((id) => {
                        return {
                            start: id.start ? Number(id.start) : 0,
                            end: id.end ? Number(id.end) : 0
                        }
                    }),
                }
            })
        }
    });
    return transfers;
}
