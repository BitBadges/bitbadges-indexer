import { BadgeMetadata, BadgeMetadataMap, BitBadgesUserInfo, DbStatus, Docs, StoredBadgeCollection, createCollectionFromMsgNewCollection } from "bitbadges-sdk"
import { MessageMsgNewCollection } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { fetchClaims } from "./claims"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgNewCollection = async (msg: MessageMsgNewCollection, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await handleNewAccountByAddress(msg.creator, docs);

    const createdCollection = createCollectionFromMsgNewCollection(msg, {} as BadgeMetadata, {} as BadgeMetadataMap, {} as BitBadgesUserInfo, [])
    const collection: StoredBadgeCollection = {
        ...createdCollection,
        manager: docs.accountNumbersMap[msg.creator],
        claims: msg.claims,
        permissions: msg.permissions,
        collectionId: status.nextCollectionId
    }

    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

    await pushToMetadataQueue(collection, status);

    collection.claims = await fetchClaims(collection);

    docs.collections[collection.collectionId] = {
        _id: docs.collections[collection.collectionId]._id,
        _rev: docs.collections[collection.collectionId]._rev,
        ...collection
    };
    docs.collections[collection.collectionId].balances = {};
    docs.collections[collection.collectionId].usedClaims = {};
    docs.collections[collection.collectionId].collectionMetadata = { name: '', description: '', image: '', };
    docs.collections[collection.collectionId].badgeMetadata = {};
    docs.collections[collection.collectionId].managerRequests = [];
    docs.collections[collection.collectionId].originalClaims = collection.claims;
    docs.collections[collection.collectionId].createdBlock = status.block.height;

    status.nextCollectionId++;

    docs = await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);

    return docs;
}