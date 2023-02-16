import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"
import { fetchBadgeMetadata, fetchMetadata } from "./handleMsgNewCollection"

export const handleMsgUpdateUris = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId]);

    collection.collectionMetadata = await fetchMetadata(collection.collectionUri);
    collection.badgeMetadata = await fetchBadgeMetadata(
        {
            start: 1,
            end: Number(collection?.nextBadgeId) - 1
        },
        collection.badgeUri
    );

    docs.collections[collection.collectionId].collectionUri = collection.collectionUri;
    docs.collections[collection.collectionId].badgeUri = collection.badgeUri;
    docs.collections[collection.collectionId].collectionMetadata = collection.collectionMetadata;
    docs.collections[collection.collectionId].badgeMetadata = collection.badgeMetadata;


    await finalizeDocsForRequest(docs.accounts, docs.collections);
}