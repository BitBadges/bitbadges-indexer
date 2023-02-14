import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { BadgeCollection, DbType } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"


export const handleMsgUpdateUris = async (event: StringEvent, db: DbType): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    db.collections[collection.collectionId].collectionUri = collection.collectionUri;
    db.collections[collection.collectionId].badgeUri = collection.badgeUri;

    //TODO: should we update metadata here?
}