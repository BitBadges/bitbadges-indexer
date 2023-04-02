import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { pushToMetadataQueue } from "../metadata-queue"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { fetchClaims } from "./claims"
import { handleNewAccount } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"
import { BadgeCollection, DbStatus, Docs, Transfers } from "bitbadges-sdk"

export const handleMsgNewCollection = async (event: StringEvent, status: DbStatus, docs: Docs): Promise<Docs> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");

    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));
    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));


    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);
    docs = await handleNewAccount(Number(collection.manager), docs);


    await pushToMetadataQueue(collection, status);

    collection.claims = await fetchClaims(collection);

    docs.collections[collection.collectionId] = {
        _id: docs.collections[collection.collectionId]._id,
        _rev: docs.collections[collection.collectionId]._rev,
        ...collection
    };
    docs.collections[collection.collectionId].balances = {};
    docs.collections[collection.collectionId].usedClaims = {};
    docs.collections[collection.collectionId].collectionMetadata = {
        name: '',
        description: '',
        image: '',
    };
    docs.collections[collection.collectionId].badgeMetadata = {};
    docs.collections[collection.collectionId].managerRequests = [];
    docs.collections[collection.collectionId].activity = [];
    docs.collections[collection.collectionId].originalClaims = collection.claims;
    docs.collections[collection.collectionId].createdBlock = status.block.height;




    docs = await handleTransfers(collection, transfers, docs);

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            docs = await handleNewAccount(Number(address), docs);
        }
    }

    return docs;
}