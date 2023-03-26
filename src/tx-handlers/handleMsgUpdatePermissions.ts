import { MessageMsgUpdatePermissions } from "bitbadgesjs-transactions"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { DbStatus } from "../types"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgUpdatePermissions = async (msg: MessageMsgUpdatePermissions, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].permissions = msg.permissions;

    return docs;
}