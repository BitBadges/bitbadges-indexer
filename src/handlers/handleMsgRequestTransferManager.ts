import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { getAttributeValueByKey } from "../indexer"
import { DbType } from "../types"
import { IndexerStargateClient } from "src/indexer_stargateclient";
import { handleNewAccount } from "./handleNewAccount";

export const handleMsgRequestTransferManager = async (event: StringEvent, db: DbType, client: IndexerStargateClient): Promise<void> => {
    const creatorString: string | undefined = getAttributeValueByKey(event.attributes, "creator");
    if (!creatorString) throw new Error(`New Collection event missing creator`)

    await handleNewAccount(Number(creatorString), db, client);

    const collectionIdString: string | undefined = getAttributeValueByKey(event.attributes, "collection_id");
    if (!collectionIdString) throw new Error(`New Collection event missing collection_id`)

    const addString: string | undefined = getAttributeValueByKey(event.attributes, "add");
    if (!addString) throw new Error(`New Collection event missing add`)

    if (addString === 'true') {
        db.collections[collectionIdString].managerRequests = [...db.collections[collectionIdString].managerRequests, creatorString];
    } else {
        db.collections[collectionIdString].managerRequests = db.collections[collectionIdString].managerRequests.filter((address: any) => address !== creatorString);
    }


}