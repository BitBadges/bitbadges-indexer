import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { BadgeCollection, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { fetchClaims, handleTransfers } from "./handleMsgNewCollection"
import { handleNewAccount } from "./handleNewAccount"

export const handleMsgMintBadge = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    const docs: Docs = await fetchDocsForRequest( [], [collection.collectionId]);

    collection.claims = await fetchClaims(collection);

    docs.collections[collection.collectionId].claims = collection.claims;
    docs.collections[collection.collectionId].unmintedSupplys = collection.unmintedSupplys;
    docs.collections[collection.collectionId].maxSupplys = collection.maxSupplys;
    docs.collections[collection.collectionId].nextBadgeId = collection.nextBadgeId;
    for (let i = docs.collections[collection.collectionId].originalClaims.length; i < collection.claims.length; i++) {
        docs.collections[collection.collectionId].originalClaims.push(collection.claims[i]);
    }

    await finalizeDocsForRequest(docs.accounts, docs.collections);


    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));
    await handleTransfers(collection, transfers);

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            await handleNewAccount(Number(address), client);
        }
    }
}