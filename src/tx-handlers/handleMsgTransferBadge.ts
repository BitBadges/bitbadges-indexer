import { DbStatus, Docs } from "bitbadges-sdk"
import { MessageMsgTransferBadge } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgTransferBadge = async (msg: MessageMsgTransferBadge, status: DbStatus, docs: Docs): Promise<Docs> => {
    const collectionIdString = `${msg.collectionId}`

    docs = await fetchDocsForRequestIfEmpty(docs, [], [Number(collectionIdString)], []);
    docs = await handleNewAccountByAddress(msg.creator, docs);
    docs = await handleTransfers(docs.collections[collectionIdString], [Number(msg.from)], msg.transfers, docs, status);

    return docs;
}