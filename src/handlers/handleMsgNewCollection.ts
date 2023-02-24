import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"
import { pushToMetadataQueue } from "./metadata"
import { fetchClaims } from "./claims"
import { handleTransfers } from "./handleTransfers"

export const handleMsgNewCollection = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

    pushToMetadataQueue(collection, status);

    collection.claims = await fetchClaims(collection);

    docs = await handleNewAccount(Number(collection.manager), client, docs);

    docs.collections[collection.collectionId] = {
        _id: docs.collections[collection.collectionId]._id,
        ...collection
    };

    docs.collections[collection.collectionId].balances = {};
    docs.collections[collection.collectionId].usedClaims = [];
    docs.collections[collection.collectionId].collectionMetadata = {};
    docs.collections[collection.collectionId].badgeMetadata = {};
    docs.collections[collection.collectionId].managerRequests = [];
    docs.collections[collection.collectionId].activity = [];
    docs.collections[collection.collectionId].originalClaims = collection.claims;

    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));

    docs = await handleTransfers(collection, transfers, docs);

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            docs = await handleNewAccount(Number(address), client, docs);
        }
    }

    return docs;
}