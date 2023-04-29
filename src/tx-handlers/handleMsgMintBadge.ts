import { BadgeMetadata, BadgeMetadataMap, BitBadgesUserInfo, ClaimItem, DbStatus, Docs, GetPermissions, StoredBadgeCollection, createCollectionFromMsgNewCollection } from "bitbadgesjs-utils"
import { MessageMsgMintBadge } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { fetchClaims } from "./claims"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgMintBadge = async (msg: MessageMsgMintBadge, status: DbStatus, docs: Docs): Promise<Docs> => {
    docs = await handleNewAccountByAddress(msg.creator, docs);
    docs = await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], []);

    const createdCollection = createCollectionFromMsgNewCollection(
        {
            ...msg,
            standard: docs.collections[msg.collectionId].standard,
            bytes: docs.collections[msg.collectionId].bytes,
            permissions: docs.collections[msg.collectionId].permissions,
            disallowedTransfers: docs.collections[msg.collectionId].disallowedTransfers,
            managerApprovedTransfers: docs.collections[msg.collectionId].managerApprovedTransfers,
        },
        {} as BadgeMetadata,
        {} as BadgeMetadataMap,
        {} as BitBadgesUserInfo,
        [],
        {
            ...docs.collections[msg.collectionId],
            manager: {} as BitBadgesUserInfo,
            permissions: GetPermissions(0),
            claims: docs.collections[msg.collectionId].claims as ClaimItem[],
            originalClaims: docs.collections[msg.collectionId].originalClaims as ClaimItem[],
            activity: [],
            announcements: [],
        },
    );

    for (const claim of msg.claims) {
        const claimItem = claim as ClaimItem;
        createdCollection.claims.push(claimItem);
        createdCollection.originalClaims.push(claimItem);
    }

    const collection: StoredBadgeCollection = {
        ...createdCollection,
        manager: docs.accountNumbersMap[msg.creator],
        permissions: docs.collections[msg.collectionId].permissions
    }

    //Handle mint transaction and update docs accordingly
    await pushToMetadataQueue(collection, status);

    //Only update the collection if the collectionUri or badgeUris have changed
    let newCollectionUri = collection.collectionUri;
    let newBadgeUris = collection.badgeUris;

    if (msg.collectionUri != "" && msg.collectionUri != collection.collectionUri) {
        newCollectionUri = msg.collectionUri;
    }

    if (msg.badgeUris.length > 0) {
        newBadgeUris = msg.badgeUris;
    }

    collection.claims = await fetchClaims(collection, docs.collections[collection.collectionId].claims.length);

    docs.collections[collection.collectionId].collectionUri = newCollectionUri;
    docs.collections[collection.collectionId].badgeUris = newBadgeUris;
    docs.collections[collection.collectionId].claims = collection.claims;
    docs.collections[collection.collectionId].unmintedSupplys = collection.unmintedSupplys;
    docs.collections[collection.collectionId].maxSupplys = collection.maxSupplys;
    docs.collections[collection.collectionId].nextBadgeId = collection.nextBadgeId;
    for (let i = docs.collections[collection.collectionId].originalClaims.length; i < collection.claims.length; i++) {
        docs.collections[collection.collectionId].originalClaims.push(collection.claims[i]);
    }

    docs = await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);

    return docs;
}