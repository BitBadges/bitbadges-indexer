import { IndexerStargateClient } from "../indexer_stargateclient"
import { DbType } from "../types"


export const handleNewAccount = async (accountNum: number, db: DbType, client: IndexerStargateClient): Promise<void> => {
    if (!db.accounts[accountNum] || !db.accounts[accountNum].pub_key.length) {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(Number(accountNum))

        if (accountInfo) {
            db.accounts[accountNum] = accountInfo
        }
    }
}