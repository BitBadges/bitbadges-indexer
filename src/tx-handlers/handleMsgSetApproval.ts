import { MessageMsgSetApproval } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { Approval, DbStatus, Docs } from "bitbadgesjs-utils";

export const handleMsgSetApproval = async (msg: MessageMsgSetApproval, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    const creatorNum = docs.accountNumbersMap[msg.creator];
    if (creatorNum === undefined) {
        throw new Error("Creator account number not found");
    }

    const approvals = docs.collections[msg.collectionId].balances[creatorNum].approvals.filter((approval: Approval) => approval.address !== msg.address);
    approvals.push({ address: msg.address, balances: msg.balances });
    approvals.sort((a: Approval, b: Approval) => Number(a.address) - Number(b.address));

    docs.collections[msg.collectionId].balances[creatorNum] = {
        balances: docs.collections[msg.collectionId].balances[creatorNum].balances,
        approvals: approvals
    }

    return docs;
}