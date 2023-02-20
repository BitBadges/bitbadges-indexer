import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"



export const handleMsgUpdatePermissions = async (event: StringEvent, client: IndexerStargateClient, status: any): Promise<void> => {
    console.log("ENTERED");
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId], []);

    docs.collections[collection.collectionId].permissions = collection.permissions;

    await finalizeDocsForRequest(docs.accounts, docs.collections, docs.metadata);
}