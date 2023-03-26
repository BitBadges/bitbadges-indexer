import { MessageMsgUpdateDisallowedTransfers } from "bitbadgesjs-transactions"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { DbStatus } from "../types"
import { handleNewAccountByAddress } from "./handleNewAccount"



export const handleMsgUpdateDisallowedTransfers = async (msg: MessageMsgUpdateDisallowedTransfers, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].disallowedTransfers = msg.disallowedTransfers;

    return docs;
}