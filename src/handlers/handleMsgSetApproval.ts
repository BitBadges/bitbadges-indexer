import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { cleanUserBalance } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgSetApproval = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    await handleNewAccount(Number(creatorString), client);

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    const docs: Docs = await fetchDocsForRequest([], [Number(collectionIdString)]);

    const userBalanceString: string | undefined = getAttributeValueByKey(event.attributes, "user_balance");
    if (!userBalanceString) throw new Error(`New Collection event missing user_balance`)


    const userBalanceJson: any = cleanUserBalance(JSON.parse(userBalanceString));
    docs.collections[collectionIdString].balances[creatorString] = userBalanceJson;

    await finalizeDocsForRequest(docs.accounts, docs.collections);
}