import { MessageMsgUpdateDisallowedTransfers } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, Docs } from "bitbadgesjs-utils";



export const handleMsgUpdateDisallowedTransfers = async (msg: MessageMsgUpdateDisallowedTransfers, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].disallowedTransfers = msg.disallowedTransfers;

    return docs;
}