import { Docs } from "./db";

export async function updateAccount(docs: Docs, accountNum: number, accountInfo: any) {
    try {
        docs.accounts[accountNum] = accountInfo;
    } catch (error) {
        throw `Error in updateAccount(): ${error}`;
    }
}