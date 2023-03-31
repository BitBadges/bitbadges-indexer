import { MessageMsgUpdateUris } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, Docs } from "bitbadges-sdk"

export const handleMsgUpdateUris = async (msg: MessageMsgUpdateUris, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);

    docs.collections[msg.collectionId].collectionUri = msg.collectionUri;
    docs.collections[msg.collectionId].badgeUris = msg.badgeUris;

    await pushToMetadataQueue(docs.collections[msg.collectionId], status);

    return docs;
}