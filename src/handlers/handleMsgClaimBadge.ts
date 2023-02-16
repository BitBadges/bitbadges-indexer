import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection, Balance } from "../types"
import { cleanBadgeCollection, cleanUserBalance } from "../util/dataCleaners"
import { fetchClaims } from "./handleMsgNewCollection"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgClaimBadge = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)



    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    collection.claims = await fetchClaims(collection);

    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId]);

    docs.collections[collection.collectionId].claims = collection.claims;

    const userBalanceString: string | undefined = getAttributeValueByKey(event.attributes, "user_balance");
    if (!userBalanceString) throw new Error(`New Collection event missing user_balance`)

    const toAddress = getAttributeValueByKey(event.attributes, "to");
    if (!toAddress) throw new Error(`New Collection event missing to`)

    const claimedBalancesStr: string | undefined = getAttributeValueByKey(event.attributes, "claimed_balances");
    if (!claimedBalancesStr) throw new Error(`New Collection event missing claimed_balances`)
    const claimedBalances: Balance[] = JSON.parse(claimedBalancesStr);

    const cleanedBalance = cleanUserBalance({
        approvals: [],
        balances: claimedBalances,
    });


    docs.collections[collection.collectionId].activity.push({
        from: ['Mint'],
        to: [toAddress],
        balances: cleanedBalance.balances,
        method: 'Mint',
    });



    const userBalanceJson: any = cleanUserBalance(JSON.parse(userBalanceString));
    docs.collections[collection.collectionId].balances[toAddress] = userBalanceJson;

    const claimDataString: string | undefined = getAttributeValueByKey(event.attributes, "claim_data");
    if (!claimDataString) throw new Error(`New Collection event missing claim_data`)

    docs.collections[collection.collectionId].balances[toAddress] = userBalanceJson;
    docs.collections[collection.collectionId].usedClaims.push(claimDataString);

    await finalizeDocsForRequest(docs.accounts, docs.collections);

    await handleNewAccount(Number(toAddress), client);
}