import { MessageMsgTransferManager } from "bitbadgesjs-transactions"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { DbStatus } from "../types"
import { handleNewAccount, handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgTransferManager = async (msg: MessageMsgTransferManager, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);
    docs = await handleNewAccount(msg.address, docs);

    docs.collections[msg.collectionId].manager = msg.address;
    docs.collections[msg.collectionId].managerRequests = docs.collections[msg.collectionId].managerRequests.filter((address: number) => Number(address) !== Number(msg.address));

    return docs;
}