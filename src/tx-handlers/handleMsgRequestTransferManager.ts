import { MessageMsgRequestTransferManager } from "bitbadgesjs-transactions";
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db";
import { DbStatus } from "../types";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgRequestTransferManager = async (msg: MessageMsgRequestTransferManager, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

     const creatorNum = docs.accountNumbersMap[msg.creator];
    if (creatorNum === undefined) {
        throw new Error("Creator account number not found");
    }

    const add = msg.addRequest;
    if (add) {
        docs.collections[msg.collectionId].managerRequests = [...docs.collections[msg.collectionId].managerRequests, creatorNum];
    } else {
        docs.collections[msg.collectionId].managerRequests = docs.collections[msg.collectionId].managerRequests.filter((address: number) => address !== creatorNum);
    }

    return docs;
}