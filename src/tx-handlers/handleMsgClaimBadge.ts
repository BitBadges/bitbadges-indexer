import { ActivityItem, AddBalancesForIdRanges, ClaimItem, DbStatus, Docs, getBalanceAfterTransfers } from "bitbadges-sdk"
import { MessageMsgClaimBadge } from "bitbadgesjs-transactions"
import nano from "nano"
import { PASSWORDS_DB, fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgClaimBadge = async (msg: MessageMsgClaimBadge, status: DbStatus, docs: Docs): Promise<Docs> => {
    let codeString = msg.codeProof.leaf;
    let addressString = msg.creator;
    let claimIdString = msg.claimId.toString();

    if (!codeString) codeString = ''
    if (!addressString) addressString = ''

    //Fetch docs if needed
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    const toAddress = docs.accountNumbersMap[msg.creator];

    const currClaimObj = docs.collections[msg.collectionId].claims[msg.claimId - 1]

    const balanceTransferred = {
        approvals: [],
        balances: [{
            balance: currClaimObj.amount,
            badgeIds: JSON.parse(JSON.stringify(currClaimObj.badgeIds)),
        }]
    };

    const newClaimBalance = getBalanceAfterTransfers(
        {
            balances: currClaimObj.balances,
            approvals: [],
        },
        [{
            toAddresses: [toAddress],
            balances: [{
                balance: currClaimObj.amount,
                badgeIds: currClaimObj.badgeIds,
            }],
        }]
    );

    currClaimObj.balances = newClaimBalance.balances;

    //Increment badgeIDS
    if (currClaimObj.incrementIdsBy) {
        for (let i = 0; i < currClaimObj.badgeIds.length; i++) {
            currClaimObj.badgeIds[i].start += currClaimObj.incrementIdsBy;
            currClaimObj.badgeIds[i].end += currClaimObj.incrementIdsBy;
        }
    }

    docs.collections[msg.collectionId].claims[msg.claimId - 1] = currClaimObj;

    const newClaims = docs.collections[msg.collectionId].claims;
    for (let i = 0; i < newClaims.length; i++) {
        const claimItem = newClaims[i] as ClaimItem;
        if (claimItem.balances.length == 0) {
            claimItem.codes = [];
            claimItem.hashedCodes = [];
            claimItem.addresses = [];

            try {
                const query: nano.MangoQuery = {
                    selector: {
                        collectionId: {
                            "$eq": msg.collectionId
                        },
                        claimId: {
                            "$eq": i + 1
                        }
                    }
                }

                const result = await PASSWORDS_DB.find(query);

                if (result.docs.length > 0) {
                    const doc = result.docs[0];
                    await PASSWORDS_DB.destroy(doc._id, doc._rev);
                }
            } catch (e) {

            }
        }
    }

    docs.collections[msg.collectionId].claims = newClaims;

    docs.activityToAdd.push({
        _id: `${docs.collections[msg.collectionId].collectionId}:${Date.now()}`,
        from: ['Mint'],
        to: [Number(toAddress)],
        balances: balanceTransferred.balances,
        collectionId: docs.collections[msg.collectionId].collectionId,
        method: 'Mint',
        block: status.block.height,
        timestamp: Date.now(),
        users: [Number(toAddress)].map((address) => {
            return { start: address, end: address }
        }),
    } as ActivityItem);

    if (docs.collections[msg.collectionId].balances[toAddress]) {
        for (const balance of balanceTransferred.balances) {
            docs.collections[msg.collectionId].balances[toAddress] = AddBalancesForIdRanges(docs.collections[msg.collectionId].balances[toAddress], balance.badgeIds, balance.balance)
        }
    } else {
        docs.collections[msg.collectionId].balances[toAddress] = balanceTransferred
    }

    docs.collections[msg.collectionId].usedClaims[claimIdString] = {
        numUsed: docs.collections[msg.collectionId].usedClaims[claimIdString]
            ? docs.collections[msg.collectionId].usedClaims[claimIdString].numUsed + 1 : 1,
        addresses: {
            ...docs.collections[msg.collectionId].usedClaims[claimIdString]?.addresses,
            [addressString]: docs.collections[msg.collectionId].usedClaims[claimIdString]?.addresses[addressString]
                ? docs.collections[msg.collectionId].usedClaims[claimIdString]?.addresses[addressString] + 1 : 1,
        },
        codes: {
            ...docs.collections[msg.collectionId].usedClaims[claimIdString]?.codes,
            [codeString]: docs.collections[msg.collectionId].usedClaims[claimIdString]?.addresses[codeString]
                ? docs.collections[msg.collectionId].usedClaims[claimIdString]?.addresses[codeString] + 1 : 1,
        }
    };

    return docs;
}