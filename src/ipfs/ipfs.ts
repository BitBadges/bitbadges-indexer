import last from 'it-last';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { ipfsClient } from "../indexer";
import axios from 'axios';
import { Metadata, BalancesMap, LeavesDetails } from 'bitbadgesjs-utils';
import { FETCHES_DB } from 'src/db/db';

//TODO: Keep track of how many GB a user has uploaded and make them pay for uploading more than threshold
//TODO: Also, we may want to eventually move IPFS uploading to the client side for scalability

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
  if (result) {
    await FETCHES_DB.insert({
      _id: `ipfs://${result.cid.toString()}`,
      fetchedAt: new Date(),
      file: balances
    });
    return result;
  } else {
    return undefined;
  }
}


export const addMetadataToIpfs = async (collectionMetadata: Metadata, individualBadgeMetadata: Metadata[]) => {
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

  //We currently don't store the images in CouchDB, so we don't need to add them to FETCHES_DB
  if (imageFiles.length > 0) {
    const imageResults = ipfsClient.addAll(imageFiles);
    const cids = [];
    for await (const imageResult of imageResults) {
      cids.push(imageResult.cid.toString());
    }

    if (collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
      const result = cids.shift();
      if (result) {
        collectionMetadata.image = 'ipfs://' + result;
      }
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

  if (result) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const metadataId = i > 0 ? Number(file.path.split('/')[2]) : -1;

      await FETCHES_DB.insert({
        _id: `ipfs://${result.cid.toString()}/${file.path}`,
        fetchedAt: new Date(),
        file: i === 0 ? collectionMetadata : individualBadgeMetadata[metadataId]
      });
    }
  }


  return result;
}

export const addClaimToIpfs = async (name: string, description: string, leavesDetails: LeavesDetails, hasPassword: boolean) => {
  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify({ name, description, leavesDetails, hasPassword }))
  });

  const result = await last(ipfsClient.addAll(files));

  if (result) {
    await FETCHES_DB.insert({
      _id: `ipfs://${result.cid.toString()}`,
      fetchedAt: new Date(),
      file: { name, description, leavesDetails, hasPassword }
    });
  }
  
  return result;
}