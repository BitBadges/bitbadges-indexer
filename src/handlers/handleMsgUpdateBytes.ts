import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"


export const handleMsgUpdateBytes = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

    docs.collections[collection.collectionId].bytes = collection.bytes;

    return docs;
}