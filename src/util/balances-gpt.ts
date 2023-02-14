//TODO: clean up a lot and insert into bitbadges-js
import { Balance, IdRange, UserBalance } from "../types";
import { GetIdRangeToInsert, GetIdRangesToInsertToStorage, GetIdRangesWithOmitEmptyCaseHandled, GetIdxSpanForRange, InsertRangeToIdRanges, NormalizeIdRange, RemoveIdsFromIdRange, SortIdRangesAndMergeIfNecessary } from "./idRanges";

// Safe adds two uint64s and returns an error if the result overflows uint64.
export function SafeAdd(left: number, right: number) {
    const sum = left + right;
    if (sum < left) {
        throw new Error("Overflow");
    }
    return sum;
}

// Safe subtracts two uint64s and returns an error if the result underflows uint64.
export function SafeSubtract(left: number, right: number) {
    // if (right > left) {
    //     throw new Error("Underflow");
    // }
    return left - right;
}

// Updates the balance for a specific id from what it currently is to newAmount.
export function UpdateBalancesForIdRanges(ranges: IdRange[], newAmount: number, balanceObjects: Balance[]) {
    ranges = SortIdRangesAndMergeIfNecessary(ranges)
    //Can maybe optimize this in the future by doing this all in one loop instead of deleting then setting
    balanceObjects = DeleteBalanceForIdRanges(ranges, balanceObjects)
    balanceObjects = SetBalanceForIdRanges(ranges, newAmount, balanceObjects)

    for (let balanceObject of balanceObjects) {
        balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds)
    }

    return balanceObjects
}

// Gets the balances for specified ID ranges. Returns a new []*types.Balance where only the specified ID ranges and their balances are included. Appends balance == 0 objects so all IDs are accounted for, even if not found.
export function GetBalancesForIdRanges(badgeIds: IdRange[], currentUserBalances: Balance[]) {
    let balanceObjectsForSpecifiedRanges: Balance[] = []
    badgeIds = SortIdRangesAndMergeIfNecessary(badgeIds)
    let idRangesNotFound = badgeIds

    console.log("badgeIds: ", badgeIds);
    console.log("currentUserBalances: ", currentUserBalances);


    for (let userBalanceObj of currentUserBalances) {
        userBalanceObj.badgeIds = GetIdRangesWithOmitEmptyCaseHandled(userBalanceObj.badgeIds)

        //For each specified range, search the current userBalanceObj's IdRanges to see if there is any overlap.
        //If so, we add the overlapping range and current balance to the new []*types.Balances to be returned.

        for (let idRange of badgeIds) {
            let res = GetIdxSpanForRange(idRange, userBalanceObj.badgeIds)
            let idxSpan: IdRange = res[0];
            let found = res[1];

            if (found) {
                idxSpan = NormalizeIdRange(idxSpan)

                //Set newIdRanges to the ranges where there is overlap
                let newIdRanges = userBalanceObj.badgeIds.slice(idxSpan.start, idxSpan.end + 1)

                //Remove everything before the start of the range. Only need to remove from idx 0 since it is sorted.
                if (idRange.start > 0 && newIdRanges.length > 0) {
                    let everythingBefore: IdRange = {
                        start: 0,
                        end: idRange.start - 1,
                    }
                    let idRangesWithEverythingBeforeRemoved = RemoveIdsFromIdRange(everythingBefore, newIdRanges[0])
                    idRangesWithEverythingBeforeRemoved = idRangesWithEverythingBeforeRemoved.concat(newIdRanges.slice(1))
                    newIdRanges = idRangesWithEverythingBeforeRemoved
                }

                //Remove everything after the end of the range. Only need to remove from last idx since it is sorted.
                if (idRange.end < Number.MAX_SAFE_INTEGER && newIdRanges.length > 0) {
                    let everythingAfter: IdRange = {
                        start: idRange.end + 1,
                        end: Number.MAX_SAFE_INTEGER,
                    }
                    let idRangesWithEverythingAfterRemoved = newIdRanges.slice(0, newIdRanges.length - 1)
                    idRangesWithEverythingAfterRemoved = idRangesWithEverythingAfterRemoved.concat(RemoveIdsFromIdRange(everythingAfter, newIdRanges[newIdRanges.length - 1]))
                    newIdRanges = idRangesWithEverythingAfterRemoved
                }

                for (let newIdRange of newIdRanges) {
                    let newNotFoundRanges: IdRange[] = []
                    for (let idRangeNotFound of idRangesNotFound) {
                        newNotFoundRanges = newNotFoundRanges.concat(RemoveIdsFromIdRange(newIdRange, idRangeNotFound))
                    }
                    idRangesNotFound = newNotFoundRanges
                }

                balanceObjectsForSpecifiedRanges = UpdateBalancesForIdRanges(newIdRanges, userBalanceObj.balance, balanceObjectsForSpecifiedRanges)

            }
        }
    }

    console.log("balance: ", balanceObjectsForSpecifiedRanges);

    //Update balance objects with IDs where balance == 0
    if (idRangesNotFound.length > 0) {
        let updatedBalances: Balance[] = []
        updatedBalances.push({
            balance: 0,
            badgeIds: idRangesNotFound,
        })
        updatedBalances = updatedBalances.concat(balanceObjectsForSpecifiedRanges)

        for (let balanceObject of updatedBalances) {
            balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds)
        }

        return updatedBalances
    } else {
        for (let balanceObject of balanceObjectsForSpecifiedRanges) {
            balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds)
        }

        return balanceObjectsForSpecifiedRanges
    }
}

// Adds a balance to all ids specified in []ranges
export function AddBalancesForIdRanges(userBalanceInfo: UserBalance, ranges: IdRange[], balanceToAdd: number) {
    let currBalances = GetBalancesForIdRanges(ranges, userBalanceInfo.balances);

    for (let i = 0; i < currBalances.length; i++) {
        let currBalanceObj = currBalances[i];
        let newBalance = SafeAdd(currBalanceObj.balance, balanceToAdd);
        userBalanceInfo.balances = UpdateBalancesForIdRanges(currBalanceObj.badgeIds, newBalance, userBalanceInfo.balances);
    }

    return GetBalanceInfoToInsertToStorage(userBalanceInfo)
}

// Subtracts a balance to all ids specified in []ranges
export function SubtractBalancesForIdRanges(userBalanceInfo: UserBalance, ranges: IdRange[], balanceToRemove: number) {
    let currBalances = GetBalancesForIdRanges(ranges, userBalanceInfo.balances);
    console.log("currBalances: ", currBalances);
    console.log("balanceToRemove: ", balanceToRemove);


    for (let currBalanceObj of currBalances) {
        let newBalance = SafeSubtract(currBalanceObj.balance, balanceToRemove);
        userBalanceInfo.balances = UpdateBalancesForIdRanges(currBalanceObj.badgeIds, newBalance, userBalanceInfo.balances);
    }

    console.log("userBalanceInfo", userBalanceInfo);

    return GetBalanceInfoToInsertToStorage(userBalanceInfo);
}

// Deletes the balance for a specific id.
export function DeleteBalanceForIdRanges(ranges: IdRange[], balanceObjects: Balance[]) {
    let newBalances: Balance[] = [];
    for (let balanceObj of balanceObjects) {
        balanceObj.badgeIds = GetIdRangesWithOmitEmptyCaseHandled(balanceObj.badgeIds);

        for (let rangeToDelete of ranges) {
            let currRanges = balanceObj.badgeIds;

            let res = GetIdxSpanForRange(rangeToDelete, currRanges);
            let idxSpan: IdRange = res[0];
            let found = res[1];

            if (found) {
                if (idxSpan.end == 0) {
                    idxSpan.end = idxSpan.start;
                }

                //Remove the ids within the rangeToDelete from existing ranges
                let newIdRanges = currRanges.slice(0, idxSpan.start);
                for (let i = idxSpan.start; i <= idxSpan.end; i++) {
                    newIdRanges = newIdRanges.concat(RemoveIdsFromIdRange(rangeToDelete, currRanges[i]));
                }
                newIdRanges = newIdRanges.concat(currRanges.slice(idxSpan.end + 1));
                balanceObj.badgeIds = newIdRanges;
            }
        }

        // If we don't have any corresponding IDs, don't store this anymore
        if (balanceObj.badgeIds.length > 0) {
            newBalances.push(balanceObj);
        }
    }

    for (let balanceObject of newBalances) {
        balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds);
    }

    return newBalances
}

// Sets the balance for a specific id. Assumes balance does not exist.
export function SetBalanceForIdRanges(ranges: IdRange[], amount: number, balanceObjects: Balance[]) {
    if (amount === 0) {
        return balanceObjects;
    }

    let res = SearchBalances(amount, balanceObjects);
    let idx = Number(res[0]);
    let found = res[1];

    let newBalances: Balance[] = [];

    if (!found) {
        //We don't have an existing object with such a balance
        newBalances = newBalances.concat(balanceObjects.slice(0, idx));
        let rangesToInsert: IdRange[] = [];
        for (let rangeToAdd of ranges) {
            rangesToInsert.push(GetIdRangeToInsert(rangeToAdd.start, rangeToAdd.end));
        }
        newBalances.push({
            balance: amount,
            badgeIds: rangesToInsert,
        });
        newBalances = newBalances.concat(balanceObjects.slice(idx));
    } else {
        newBalances = balanceObjects;
        newBalances[idx].badgeIds = GetIdRangesWithOmitEmptyCaseHandled(newBalances[idx].badgeIds);
        for (let rangeToAdd of ranges) {
            newBalances[idx].badgeIds = InsertRangeToIdRanges(rangeToAdd, newBalances[idx].badgeIds);
        }

    }

    for (let balanceObject of newBalances) {
        balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds);
    }

    return newBalances
}

// Balances will be sorted, so we can binary search to get the targetIdx.
// If found, returns (the index it was found at, true). Else, returns (index to insert at, false).
export function SearchBalances(targetAmount: number, balanceObjects: Balance[]) {
    let balanceLow = 0;
    let balanceHigh = balanceObjects.length - 1;
    let median = 0;
    let hasEntryWithSameBalance = false;
    let idx = 0;

    while (balanceLow <= balanceHigh) {
        median = Math.floor((balanceLow + balanceHigh) / 2);
        if (balanceObjects[median].balance === targetAmount) {
            hasEntryWithSameBalance = true;
            break;
        } else if (balanceObjects[median].balance > targetAmount) {
            balanceHigh = median - 1;
        } else {
            balanceLow = median + 1;
        }
    }

    if (balanceObjects.length != 0) {
        idx = median + 1
        if (targetAmount <= balanceObjects[median].balance) {
            idx = median
        }
    }

    return [idx, hasEntryWithSameBalance]
}

//Normalizes everything to save storage space. If start == end, we set end to 0 so it doens't store.
export function GetBalanceInfoToInsertToStorage(balanceInfo: UserBalance) {
    for (let balanceObject of balanceInfo.balances) {
        balanceObject.badgeIds = GetIdRangesToInsertToStorage(balanceObject.badgeIds);
    }

    for (let approvalObject of balanceInfo.approvals) {
        for (let approvalAmountObject of approvalObject.balances) {
            approvalAmountObject.badgeIds = GetIdRangesToInsertToStorage(approvalAmountObject.badgeIds);
        }
    }

    return balanceInfo
}
