import axios from "axios";
import { getFromIpfs } from "../ipfs/ipfs";
import { BadgeCollection, BadgeMetadata, IdRange } from "../types";

export const fetchMetadata = async (uri: string): Promise<BadgeMetadata> => {
    if (uri.startsWith('ipfs://')) {
        const res = await getFromIpfs(uri.replace('ipfs://', ''));
        return JSON.parse(res.file);
    } else {
        const res = await axios.get(uri).then((res) => res.data);
        return res;
    }
}

export const fetchBadgeMetadata = async (badgeIdsToFetch: IdRange, badgeUri: string): Promise<{ [badgeId: string]: BadgeMetadata }> => {
    //Create empty array for all unique badges if it does not exist on the current badge object
    //Get the individual badge metadata
    let badgeMetadata: { [badgeId: string]: BadgeMetadata } = {};
    for (let i = badgeIdsToFetch.start; i <= Number(badgeIdsToFetch.end); i++) {
        badgeMetadata[i] = await fetchMetadata(badgeUri.replace('{id}', i.toString())); //TODO: dynamic
    }

    return badgeMetadata;
}

export const pushToMetadataQueue = async (collection: BadgeCollection, status: any) => {
    status.queue.push({
        collectionUri: collection.collectionUri,
        badgeUri: collection.badgeUri,
        collection: true,
        collectionId: collection.collectionId,
        badgeIds: {
            start: 1,
            end: Number(collection?.nextBadgeId) - 1
        }
    });
}


