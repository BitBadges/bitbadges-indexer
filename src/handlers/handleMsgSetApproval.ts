import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { DbType } from "../types"
import { cleanUserBalance } from "../util/dataCleaners"

export const handleMsgSetApproval = async (event: StringEvent, db: DbType): Promise<void> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    const userBalanceString: string | undefined = getAttributeValueByKey(event.attributes, "user_balance");
    if (!userBalanceString) throw new Error(`New Collection event missing user_balance`)


    const userBalanceJson: any = cleanUserBalance(JSON.parse(userBalanceString));
    db.collections[collectionIdString].balances[creatorString] = userBalanceJson;
}