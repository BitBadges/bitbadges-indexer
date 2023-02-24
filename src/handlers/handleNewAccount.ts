import { Docs, fetchDocsForRequestIfEmpty } from "../db/db";
import { IndexerStargateClient } from "../indexer_stargateclient";


export const handleNewAccount = async (accountNum: number, client: IndexerStargateClient, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [accountNum], [], []);

    let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(accountNum))
    if (accountInfo) {
        docs.accounts[accountNum] = {
            _id: docs.accounts[accountNum]._id,
            _rev: docs.accounts[accountNum]._rev,
            ...accountInfo,
        }
    }

    return docs;
}