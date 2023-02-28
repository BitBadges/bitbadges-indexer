import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"
import { pushToMetadataQueue } from "./metadata"

export const handleMsgUpdateUris = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    docs = await fetchDocsForRequest([], [collection.collectionId], []);

    docs.collections[collection.collectionId].collectionUri = collection.collectionUri;
    docs.collections[collection.collectionId].badgeUris = collection.badgeUris;
    docs.collections[collection.collectionId].collectionMetadata = collection.collectionMetadata;
    docs.collections[collection.collectionId].badgeMetadata = collection.badgeMetadata;

    pushToMetadataQueue(collection, status);

    return docs;
}