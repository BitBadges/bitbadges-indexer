import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { BadgeCollection, DbType } from "../types"
import { cleanBadgeCollection } from "../util/dataCleaners"
import { IndexerStargateClient } from "../indexer_stargateclient"


export const handleMsgUpdateBytes = async (event: StringEvent, db: DbType, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));

    db.collections[collection.collectionId].bytes = collection.bytes;
}