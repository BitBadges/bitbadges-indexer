import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { Transfers, UserBalance } from "../types"
import { cleanTransfers, cleanUserBalance } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgTransferBadge = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    //TODO: creator account handling

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    docs = await fetchDocsForRequestIfEmpty(docs, [], [Number(collectionIdString)], []);

    const newBalancesString: string | undefined = getAttributeValueByKey(event.attributes, "new_balances");
    if (!newBalancesString) throw new Error(`New Collection event missing new_balance`)

    const newBalancesAccountNumsString: string | undefined = getAttributeValueByKey(event.attributes, "new_balance_accounts");
    if (!newBalancesAccountNumsString) throw new Error(`New Collection event missing new_balance_accounts`)

    const newBalances: UserBalance[] = JSON.parse(newBalancesString);
    const newBalancesAccountNums: string[] = JSON.parse(newBalancesAccountNumsString);

    for (let i = 0; i < newBalances.length; i++) {
        const accountNum = newBalancesAccountNums[i];
        const balance = newBalances[i];
        docs.collections[collectionIdString].balances[accountNum] = cleanUserBalance(balance);

        docs = await handleNewAccount(Number(accountNum), client, docs);
    }

    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));

    for (let i = 0; i < transfers.length; i++) {
        const transfer = transfers[i];

        docs.collections[collectionIdString].activity.push({
            from: newBalancesAccountNums.slice(-1),
            to: transfer.toAddresses,
            balances: transfer.balances,
            method: 'Transfer',
        });
    }

    return docs;
}