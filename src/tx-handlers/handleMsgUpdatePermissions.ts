import { MessageMsgUpdatePermissions } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, Docs } from "bitbadgesjs-utils";

export const handleMsgUpdatePermissions = async (msg: MessageMsgUpdatePermissions, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].permissions = msg.permissions;

    return docs;
}