import { MessageMsgUpdateBytes } from "bitbadgesjs-transactions"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { DbStatus } from "../types"
import { handleNewAccountByAddress } from "./handleNewAccount"


export const handleMsgUpdateBytes = async (msg: MessageMsgUpdateBytes, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].bytes = msg.newBytes;

    return docs;
}