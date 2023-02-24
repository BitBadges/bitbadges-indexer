import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci";
import { IndexerStargateClient } from "src/indexer_stargateclient";
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db";
import { getAttributeValueByKey } from "../indexer";
import { handleNewAccount } from "./handleNewAccount";

export const handleMsgRequestTransferManager = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    docs = await handleNewAccount(Number(creatorString), client, docs);

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    docs = await fetchDocsForRequestIfEmpty(docs, [], [Number(collectionIdString)], []);

    const addString: string | undefined = getAttributeValueByKey(event.attributes, "add");
    if (!addString) throw new Error(`New Collection event missing add`)

    if (addString === 'true') {
        docs.collections[collectionIdString].managerRequests = [...docs.collections[collectionIdString].managerRequests, creatorString];
    } else {
        docs.collections[collectionIdString].managerRequests = docs.collections[collectionIdString].managerRequests.filter((address: any) => address !== creatorString);
    }

    return docs;
}