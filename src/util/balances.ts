//TODO: clean this up and put it in bitbadges-js
import { SubtractBalancesForIdRanges } from "./balances-gpt";
import { UserBalance } from "../types";

export const getBlankBalance = () => {
    const blankBalance: UserBalance = {
        balances: [],
        approvals: [],
    }
    return blankBalance;
}

export const getPostTransferBalance = (balance: UserBalance, startSubbadgeId: number, endSubbadgeId: number, amountToTransfer: number, numRecipients: number) => {
    let balanceCopy = JSON.parse(JSON.stringify(balance)); // need a deep copy of the balance to not mess up calculations
    let newBalance = SubtractBalancesForIdRanges(balanceCopy, [{ start: startSubbadgeId, end: endSubbadgeId }], amountToTransfer * numRecipients);
    return newBalance;
}

// export const getBadgeSupplysFromMsgNewCollection = (msgNewCollection: MessageMsgNewCollection) => {
//     const beforeBalances: UserBalance = {
//         balances: [
//             {
//                 balance: msgNewCollection.badgeSupplys[0]?.supply,
//                 badgeIds: [{
//                     start: 0,
//                     end: msgNewCollection.badgeSupplys[0]?.amount - 1,
//                 }]
//             }
//         ],
//         approvals: [],
//     }
//     return beforeBalances;
// }

