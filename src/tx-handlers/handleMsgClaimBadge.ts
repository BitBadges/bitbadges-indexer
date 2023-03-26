import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { BadgeCollection, Balance, DbStatus } from "../types"
import { cleanBadgeCollection, cleanUserBalance } from "../util/dataCleaners"
import { fetchClaims } from "./claims"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgClaimBadge = async (event: StringEvent, status: DbStatus, docs: Docs): Promise<Docs> => {
    //Fetch events
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    const userBalanceString: string | undefined = getAttributeValueByKey(event.attributes, "user_balance");
    const toAddress = getAttributeValueByKey(event.attributes, "to");
    const claimedBalancesStr: string | undefined = getAttributeValueByKey(event.attributes, "claimed_balances");
    const claimIdString: string | undefined = getAttributeValueByKey(event.attributes, "claim_id");
    let codeString = getAttributeValueByKey(event.attributes, "code");
    let addressString = getAttributeValueByKey(event.attributes, "address");

    if (!claimIdString) throw new Error(`New Collection event missing claim_id`)
    if (!collectionString) throw new Error(`New Collection event missing collection`)
    if (!userBalanceString) throw new Error(`New Collection event missing user_balance`)
    if (!toAddress) throw new Error(`New Collection event missing to`)
    if (!claimedBalancesStr) throw new Error(`New Collection event missing claimed_balances`)
    if (!codeString) codeString = ''
    if (!addressString) addressString = ''

    //Clean if needed
    const claimedBalances: Balance[] = JSON.parse(claimedBalancesStr);
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    const cleanedBalance = cleanUserBalance({ approvals: [], balances: claimedBalances, });
    const userBalanceJson: any = cleanUserBalance(JSON.parse(userBalanceString));

    //Fetch docs if needed
    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);
    docs = await handleNewAccount(Number(toAddress), docs);

    //Update docs with new data from the claim
    collection.claims = await fetchClaims(collection);
    docs.collections[collection.collectionId].claims = collection.claims;
    docs.collections[collection.collectionId].activity.push({
        from: ['Mint'],
        to: [Number(toAddress)],
        balances: cleanedBalance.balances,
        method: 'Mint',
    });
    docs.collections[collection.collectionId].balances[toAddress] = userBalanceJson;
    docs.collections[collection.collectionId].usedClaims[claimIdString] = {
        numUsed: docs.collections[collection.collectionId].usedClaims[claimIdString]
            ? docs.collections[collection.collectionId].usedClaims[claimIdString].numUsed + 1 : 1,
        addresses: {
            ...docs.collections[collection.collectionId].usedClaims[claimIdString]?.addresses,
            [addressString]: docs.collections[collection.collectionId].usedClaims[claimIdString]?.addresses[addressString]
                ? docs.collections[collection.collectionId].usedClaims[claimIdString]?.addresses[addressString] + 1 : 1,
        },
        codes: {
            ...docs.collections[collection.collectionId].usedClaims[claimIdString]?.codes,
            [codeString]: docs.collections[collection.collectionId].usedClaims[claimIdString]?.addresses[codeString]
                ? docs.collections[collection.collectionId].usedClaims[claimIdString]?.addresses[codeString] + 1 : 1,
        }
    };

    return docs;
}