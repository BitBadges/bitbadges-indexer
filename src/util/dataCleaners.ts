import { StoredBadgeCollection, Transfers, UserBalance } from "bitbadgesjs-utils";

export function cleanStoredBadgeCollection(collection: StoredBadgeCollection) {
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
    collection.badgeUris = collection.badgeUris ? collection.badgeUris : [];
    collection.bytes = collection.bytes ? collection.bytes : ""
    collection.manager = collection.manager ? Number(collection.manager) : 0;

    collection.disallowedTransfers = collection.disallowedTransfers.map((transfer) => {
        return {
            to: {
                accountIds: transfer.to.accountIds ? transfer.to.accountIds.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.to.options ? Number(transfer.to.options) : 0
            },
            from: {
                accountIds: transfer.from.accountIds ? transfer.from.accountIds.map((accountNum) => {
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
                accountIds: transfer.to.accountIds ? transfer.to.accountIds.map((accountNum) => {
                    return {
                        start: accountNum.start ? Number(accountNum.start) : 0,
                        end: accountNum.end ? Number(accountNum.end) : 0
                    }
                }) : [],
                options: transfer.to.options ? Number(transfer.to.options) : 0
            },
            from: {
                accountIds: transfer.from.accountIds ? transfer.from.accountIds.map((accountNum) => {
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
            codeRoot: claim.codeRoot ? claim.codeRoot : "",
            whitelistRoot: claim.whitelistRoot ? claim.whitelistRoot : "",
            uri: claim.uri ? claim.uri : "",
            timeRange: {
                start: claim.timeRange.start ? Number(claim.timeRange.start) : 0,
                end: claim.timeRange.end ? Number(claim.timeRange.end) : 0
            },
            restrictOptions: claim.restrictOptions ? Number(claim.restrictOptions) : 0,
            amount: claim.amount ? Number(claim.amount) : 0,
            badgeIds: claim.badgeIds ? claim.badgeIds.map((id) => {
                return {
                    start: id.start ? Number(id.start) : 0,
                    end: id.end ? Number(id.end) : 0
                }
            }) : [],
            incrementIdsBy: claim.incrementIdsBy ? Number(claim.incrementIdsBy) : 0,
            expectedMerkleProofLength: claim.expectedMerkleProofLength ? Number(claim.expectedMerkleProofLength) : 0,
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