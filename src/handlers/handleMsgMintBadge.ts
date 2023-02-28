import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"
import { fetchClaims } from "./claims"
import { handleTransfers } from "./handleTransfers"
import { pushToMetadataQueue } from "./metadata"

export const handleMsgMintBadge = async (event: StringEvent, client: IndexerStargateClient, status: any, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

    await pushToMetadataQueue(collection, status);

    console.log(collection);
    collection.claims = await fetchClaims(collection);

    docs.collections[collection.collectionId].claims = collection.claims;
    docs.collections[collection.collectionId].unmintedSupplys = collection.unmintedSupplys;
    docs.collections[collection.collectionId].maxSupplys = collection.maxSupplys;
    docs.collections[collection.collectionId].nextBadgeId = collection.nextBadgeId;
    for (let i = docs.collections[collection.collectionId].originalClaims.length; i < collection.claims.length; i++) {
        docs.collections[collection.collectionId].originalClaims.push(collection.claims[i]);
    }


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