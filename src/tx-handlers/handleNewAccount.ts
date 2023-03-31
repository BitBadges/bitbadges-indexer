import { Docs } from "bitbadges-sdk";
import { fetchDocsForRequestIfEmpty } from "../db/db";
import { client } from "../indexer";

export const handleNewAccount = async (accountNum: number, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [accountNum], [], []);

    if (!docs.accounts[accountNum] || !docs.accounts[accountNum].cosmosAddress) {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(accountNum))
        if (accountInfo) {
            docs.accounts[accountNum] = {
                _id: docs.accounts[accountNum]._id,
                _rev: docs.accounts[accountNum]._rev,
                ...accountInfo,
            }
            docs.accountNumbersMap[accountInfo.cosmosAddress] = accountNum;
        }
    }

    return docs;
}

export const handleNewAccountByAddress = async (cosmosAddress: string, docs: Docs): Promise<Docs> => {
    if (!(docs.accountNumbersMap[cosmosAddress] >= 0)) {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(cosmosAddress)

        if (accountInfo) {
            let accountNum = accountInfo?.account_number >= 0 ? Number(accountInfo.account_number) : -1;
            docs = await fetchDocsForRequestIfEmpty(docs, [accountNum], [], []);

            docs.accounts[accountNum] = {
                _id: docs.accounts[accountNum]._id,
                _rev: docs.accounts[accountNum]._rev,
                ...accountInfo,
            }
            docs.accountNumbersMap[accountInfo.cosmosAddress] = accountNum;
        }
    }

    return docs;
}