import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { pushToMetadataQueue } from "../metadata-queue"
import { BadgeCollection, DbStatus, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { fetchClaims } from "./claims"
import { handleNewAccount } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgMintBadge = async (event: StringEvent, status: DbStatus, docs: Docs): Promise<Docs> => {
    //Fetch events
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");

    //Validate
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    if (!collectionString) throw new Error(`New Collection event missing collection`)

    //Clean if needed
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    //Handle mint transaction and update docs accordingly
    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);
    await pushToMetadataQueue(collection, status);

    collection.claims = await fetchClaims(collection);

    docs.collections[collection.collectionId].collectionUri = collection.collectionUri;
    docs.collections[collection.collectionId].badgeUris = collection.badgeUris;
    docs.collections[collection.collectionId].claims = collection.claims;
    docs.collections[collection.collectionId].unmintedSupplys = collection.unmintedSupplys;
    docs.collections[collection.collectionId].maxSupplys = collection.maxSupplys;
    docs.collections[collection.collectionId].nextBadgeId = collection.nextBadgeId;
    for (let i = docs.collections[collection.collectionId].originalClaims.length; i < collection.claims.length; i++) {
        docs.collections[collection.collectionId].originalClaims.push(collection.claims[i]);
    }

    docs = await handleTransfers(collection, transfers, docs);

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            docs = await handleNewAccount(Number(address), docs);
        }
    }

    return docs;
}