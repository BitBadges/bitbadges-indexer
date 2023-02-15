import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"


export const handleMsgTransferManager = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    //TODO: handle new manager account


    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId]);

    docs.collections[collection.collectionId].manager = collection.manager;
    docs.collections[collection.collectionId].managerRequests = docs.collections[collection.collectionId].managerRequests.filter((address: any) => Number(address) !== Number(collection.manager));

    await finalizeDocsForRequest(docs.accounts, docs.collections);
}