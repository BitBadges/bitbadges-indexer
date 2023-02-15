import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db";
import { IndexerStargateClient } from "../indexer_stargateclient";


export const handleNewAccount = async (accountNum: number, client: IndexerStargateClient): Promise<void> => {
    const docs: Docs = await fetchDocsForRequest([accountNum], []);

    if (!docs.accounts[accountNum].address) { //is just a template
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(accountNum))

        if (accountInfo) {
            docs.accounts[accountNum] = {
                _id: docs.accounts[accountNum]._id,
                ...accountInfo,
            }
        }
    }

    await finalizeDocsForRequest(docs.accounts, docs.collections);
}