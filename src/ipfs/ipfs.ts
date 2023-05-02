import last from 'it-last';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { ipfsClient } from "../indexer";
import axios from 'axios';
import { BadgeMetadata, BalancesMap } from 'bitbadgesjs-utils';


export const getFromIpfs = async (path: string) => {
    if (!path) return { file: '{}' }

    const getRes = ipfsClient.cat(path);

    const decoder = new TextDecoder();
    let fileContents = '';
    for await (const file of getRes) {
        let chunk = decoder.decode(file);
        fileContents += chunk;
    }

    return { file: fileContents };
}

export async function dataUrlToFile(dataUrl: string): Promise<ArrayBuffer> {
    const res = await axios.get(dataUrl, { responseType: 'arraybuffer' });
    const blob = res.data;
    return blob
}

export const addBalancesToIpfs = async (balances: BalancesMap) => {
  const files = [];
  files.push({
      path: '',
      content: uint8ArrayFromString(JSON.stringify(balances))
  });

  const result = await last(ipfsClient.addAll(files));

  return result;
}


export const addToIpfs = async (collectionMetadata: BadgeMetadata, individualBadgeMetadata: BadgeMetadata[]) => {
    const imageFiles = [];
    if (collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
        const blob = await dataUrlToFile(collectionMetadata.image);
        imageFiles.push({
            content: new Uint8Array(blob)
        });
    }

    for (const badge of individualBadgeMetadata) {
        if (badge.image && badge.image.startsWith('data:image')) {
            const blob = await dataUrlToFile(badge.image);
            imageFiles.push({
                content: new Uint8Array(blob)
            });
        }
    }

    if (imageFiles.length > 0) {
        const imageResults = ipfsClient.addAll(imageFiles);
        const cids = [];
        for await (const imageResult of imageResults) {
            cids.push(imageResult.cid.toString());
        }

        if (collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
            const result = cids.shift();
            if (result) collectionMetadata.image = 'ipfs://' + result;
        }

        for (const badge of individualBadgeMetadata) {
            if (badge.image && badge.image.startsWith('data:image')) {
                const result = cids.shift();
                if (result) badge.image = 'ipfs://' + result;
            }
        }
    }

    const files = [];
    files.push({
        path: 'metadata/collection',
        content: uint8ArrayFromString(JSON.stringify(collectionMetadata))
    });

    for (const id of Object.keys(individualBadgeMetadata)) {
        files.push(
            {
                path: 'metadata/batch/' + id,
                content: uint8ArrayFromString(JSON.stringify(individualBadgeMetadata[Number(id)]))
            }
        );
    }

    const result = await last(ipfsClient.addAll(files));

    return result;
}

export const addMerkleTreeToIpfs = async (name: string, description: string,leaves: string[], addresses: string[], codes: string[], hasPassword: boolean) => {
    const files = [];
    files.push({
        path: '',
        content: uint8ArrayFromString(JSON.stringify({ name, description, leaves, addresses, codes, hasPassword }))
    });

    const result = await last(ipfsClient.addAll(files));
    return result;
}