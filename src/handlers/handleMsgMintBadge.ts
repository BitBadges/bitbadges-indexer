import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { BadgeCollection, DbType, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { fetchClaims, handleTransfers } from "./handleMsgNewCollection"

export const handleMsgMintBadge = async (event: StringEvent, db: DbType): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`)
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    collection.claims = await fetchClaims(collection);

    db.collections[collection.collectionId].claims = collection.claims;
    db.collections[collection.collectionId].unmintedSupplys = collection.unmintedSupplys;
    db.collections[collection.collectionId].maxSupplys = collection.maxSupplys;
    db.collections[collection.collectionId].nextBadgeId = collection.nextBadgeId;
    for (let i = db.collections[collection.collectionId].originalClaims.length; i < collection.claims.length; i++) {
        db.collections[collection.collectionId].originalClaims.push(collection.claims[i]);
    }
    

    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));
    await handleTransfers(collection, transfers, db);
}