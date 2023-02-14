import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { BadgeCollection, Balance, DbType } from "../types"
import { cleanBadgeCollection, cleanUserBalance } from "../util/dataCleaners"
import { fetchClaims } from "./handleMsgNewCollection"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgClaimBadge = async (event: StringEvent, db: DbType, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    collection.claims = await fetchClaims(collection);

    db.collections[collection.collectionId].claims = collection.claims;

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


    db.collections[collection.collectionId].activity.push({
        from: ['Mint'],
        to: [toAddress],
        balances: cleanedBalance.balances,
        method: 'Claim',
    });



    const userBalanceJson: any = cleanUserBalance(JSON.parse(userBalanceString));
    db.collections[collection.collectionId].balances[toAddress] = userBalanceJson;

    const claimDataString: string | undefined = getAttributeValueByKey(event.attributes, "claim_data");
    if (!claimDataString) throw new Error(`New Collection event missing claim_data`)

    db.collections[collection.collectionId].balances[toAddress] = userBalanceJson;
    db.collections[collection.collectionId].usedClaims.push(claimDataString);


    await handleNewAccount(Number(toAddress), db, client);
}