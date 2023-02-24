import last from 'it-last';
import { BadgeMetadata } from "src/types";
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { ipfsClient } from "../indexer";

export const getFromIpfs = async (path: string) => {
    const getRes = ipfsClient.cat(path);

    const decoder = new TextDecoder();
    let fileJson = '';
    for await (const file of getRes) {
        let chunk = decoder.decode(file);
        fileJson += chunk;
    }

    return { file: fileJson };
}

export const addToIpfs = async (collectionMetadata: BadgeMetadata, individualBadgeMetadata: BadgeMetadata[]) => {
    const files = [];
    files.push({
        path: 'metadata/collection',
        content: uint8ArrayFromString(JSON.stringify(collectionMetadata))
    });

    for (const id of Object.keys(individualBadgeMetadata)) {
        files.push(
            {
                path: 'metadata/' + id,
                content: uint8ArrayFromString(JSON.stringify(individualBadgeMetadata[Number(id)]))
            }
        );
    }

    const result = await last(ipfsClient.addAll(files));

    return result;
}

export const addMerkleTreeToIpfs = async (leaves: string[]) => {
    const files = [];
    files.push({
        path: '',
        content: uint8ArrayFromString(JSON.stringify(leaves))
    });

    const result = await last(ipfsClient.addAll(files));
    return result;
}