import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db";
import { IndexerStargateClient } from "../indexer_stargateclient";


export const handleNewAccount = async (accountNum: number, client: IndexerStargateClient): Promise<void> => {
    const docs: Docs = await fetchDocsForRequest([accountNum], [], []);

    let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(accountNum))
    console.log("ACCOUNT INFO", accountInfo)
    if (accountInfo) {
        docs.accounts[accountNum] = {
            _id: docs.accounts[accountNum]._id,
            _rev: docs.accounts[accountNum]._rev,
            ...accountInfo,
        }
    }

    await finalizeDocsForRequest(docs.accounts, docs.collections, docs.metadata);
}