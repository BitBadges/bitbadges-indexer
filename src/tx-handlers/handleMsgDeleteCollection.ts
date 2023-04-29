import { DbStatus, Docs } from "bitbadgesjs-utils"
import { MessageMsgMintBadge } from "bitbadgesjs-transactions"
import { METADATA_DB, fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgDeleteCollection = async (msg: MessageMsgMintBadge, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await handleNewAccountByAddress(msg.creator, docs);
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);

    docs.collections[msg.collectionId]._deleted = true;


    //Delete partition
    const allDocs = await METADATA_DB.partitionedList(`${msg.collectionId}`);


    const promises = [];
    for (const doc of allDocs.rows) {
        promises.push(METADATA_DB.destroy(doc.id, doc.value.rev));
    }

    await Promise.all(promises);

    //Delete all metadata docs from docs object (safe to do because no TXs will be processed after this delete one)
    for (const key of Object.keys(docs.metadata)) {
        if (key.split(':')[0] === `${msg.collectionId}`) {
            delete docs.metadata[key];
        }
    }

    return docs;
}