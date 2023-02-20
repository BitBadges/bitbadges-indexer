import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci";
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db";
import { IndexerStargateClient } from "src/indexer_stargateclient";
import { getAttributeValueByKey } from "../indexer";
import { handleNewAccount } from "./handleNewAccount";

export const handleMsgRequestTransferManager = async (event: StringEvent, client: IndexerStargateClient, status: any): Promise<void> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    await handleNewAccount(Number(creatorString), client);

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    const docs: Docs = await fetchDocsForRequest([], [Number(collectionIdString)], []);

    const addString: string | undefined = getAttributeValueByKey(event.attributes, "add");
    if (!addString) throw new Error(`New Collection event missing add`)

    if (addString === 'true') {
        docs.collections[collectionIdString].managerRequests = [...docs.collections[collectionIdString].managerRequests, creatorString];
    } else {
        docs.collections[collectionIdString].managerRequests = docs.collections[collectionIdString].managerRequests.filter((address: any) => address !== creatorString);
    }

    await finalizeDocsForRequest(docs.accounts, docs.collections, docs.metadata);

}