import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { DbType, UserBalance } from "../types"
import { cleanUserBalance } from "../util/dataCleaners"

export const handleMsgTransferBadge = async (event: StringEvent, db: DbType): Promise<void> => {
    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    const newBalancesString: string | undefined = getAttributeValueByKey(event.attributes, "new_balances");
    if (!newBalancesString) throw new Error(`New Collection event missing new_balance`)

    const newBalancesAccountNumsString: string | undefined = getAttributeValueByKey(event.attributes, "new_balances_accounts");
    if (!newBalancesAccountNumsString) throw new Error(`New Collection event missing new_balances_accounts`)

    const newBalances: UserBalance[] = JSON.parse(newBalancesString);
    const newBalancesAccountNums: string[] = JSON.parse(newBalancesAccountNumsString);

    for (let i = 0; i < newBalances.length; i++) {
        const accountNum = newBalancesAccountNums[i];
        const balance = newBalances[i];
        db.collections[collectionIdString].balances[accountNum] = cleanUserBalance(balance);
    }
}