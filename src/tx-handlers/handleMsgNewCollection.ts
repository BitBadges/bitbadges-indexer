import { MessageMsgNewCollection } from "bitbadgesjs-transactions"
import { BadgeMetadata, BadgeMetadataMap, BalancesMap, BitBadgesUserInfo, DbStatus, Docs, StoredBadgeCollection, createCollectionFromMsgNewCollection } from "bitbadgesjs-utils"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { fetchUri, pushToMetadataQueue } from "../metadata-queue"
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
        collectionId: status.nextCollectionId,
        standard: msg.standard
    }

    docs = await fetchDocsForRequestIfEmpty(docs, [], [collection.collectionId], []);

    await pushToMetadataQueue(collection, status);

    collection.claims = await fetchClaims(collection);

    let balanceMap: BalancesMap = {}
    if (collection.standard === 1) {
      try {
        //check if bytes
        balanceMap = await fetchUri(collection.bytes);
        //TODO: validate types
      } catch (e) {
        
      }
    }


    docs.collections[collection.collectionId] = {
        _id: docs.collections[collection.collectionId]._id,
        _rev: docs.collections[collection.collectionId]._rev,
        ...collection
    };
    docs.collections[collection.collectionId].balances = balanceMap;
    docs.collections[collection.collectionId].usedClaims = {};
    docs.collections[collection.collectionId].collectionMetadata = { name: '', description: '', image: '', };
    docs.collections[collection.collectionId].badgeMetadata = {};
    docs.collections[collection.collectionId].managerRequests = [];
    docs.collections[collection.collectionId].userList = [];
    docs.collections[collection.collectionId].originalClaims = collection.claims;
    docs.collections[collection.collectionId].createdBlock = status.block.height;

    status.nextCollectionId++;

    docs = await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);

    return docs;
}