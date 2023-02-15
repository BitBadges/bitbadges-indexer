import { BadgeCollection, DistributionMethod, Transfers, UserBalance } from "../types";

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
                accountNums: transfer.to.accountNums ? transfer.to.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.to.options ? Number(transfer.to.options) : 0
            },
            from: {
                accountNums: transfer.from.accountNums ? transfer.from.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.from.options ? Number(transfer.from.options) : 0
            }
        }
    });

    collection.managerApprovedTransfers = collection.managerApprovedTransfers.map((transfer) => {
        return {
            to: {
                accountNums: transfer.to.accountNums ? transfer.to.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.to.options ? Number(transfer.to.options) : 0
            },
            from: {
                accountNums: transfer.from.accountNums ? transfer.from.accountNums.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.from.options ? Number(transfer.from.options) : 0
            }
        }
    });

    collection.claims = collection.claims.map((claim) => {
        return {
            balances: claim.balances ? claim.balances.map((balance) => {
                return {
                    balance: balance.balance ? Number(balance.balance) : 0,
                    badgeIds: balance.badgeIds.map((id) => {
                        return {
                            start: id.start ? Number(id.start) : 0,
                            end: id.end ? Number(id.end) : 0
                        }
                    })
                }
            }) : [],
            badgeIds: claim.badgeIds ? claim.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }) : [],
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
            distributionMethod: DistributionMethod.None,
            tree: null
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
    transfers = transfers ? transfers.map((transfer) => {
        return {
            toAddresses: transfer.toAddresses ? transfer.toAddresses : [],
            balances: transfer.balances ? transfer.balances.map((supply) => {
                return {
                    balance: supply.balance ? Number(supply.balance) : 0,
                    badgeIds: supply.badgeIds.map((id) => {
                        return {
                            start: id.start ? Number(id.start) : 0,
                            end: id.end ? Number(id.end) : 0
                        }
                    }),
                }
            }) : []
        }
    }) : [];
    return transfers;
}

export function cleanUserBalance(balance: UserBalance) {
    balance.balances = balance.balances ? balance.balances : [];
    balance.approvals = balance.approvals ? balance.approvals : [];

    balance.balances = balance.balances.map((supply) => {
        return {
            balance: supply.balance ? Number(supply.balance) : 0,
            badgeIds: supply.badgeIds ? supply.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }) : [],
        }
    })

    balance.approvals = balance.approvals.map((approval) => {
        return {
            address: approval.address ? approval.address : 0,
            balances: approval.balances.map((supply) => {
                return {
                    balance: supply.balance ? Number(supply.balance) : 0,
                    badgeIds: supply.badgeIds ? supply.badgeIds.map((id) => {
                        return {
                            start: id.start ? Number(id.start) : 0,
                            end: id.end ? Number(id.end) : 0
                        }
                    }) : [],
                }
            })
        }
    })

    return balance;
}