import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection, Balance } from "../types"
import { cleanBadgeCollection, cleanUserBalance } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"
import { fetchClaims } from "./claims"

export const handleMsgClaimBadge = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)



    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    collection.claims = await fetchClaims(collection);

    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

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

    docs = await handleNewAccount(Number(toAddress), client, docs);

    return docs;
}