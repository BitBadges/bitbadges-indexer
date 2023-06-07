import axios from 'axios';
import { BalancesMap, BigIntify, LeavesDetails, Metadata, MetadataMap, convertBalancesMap, convertMetadata, convertMetadataMap } from 'bitbadgesjs-utils';
import last from 'it-last';
import { FETCHES_DB, insertToDB } from '../db/db';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { ipfsClient } from "../indexer";
import { NumberType } from 'bitbadgesjs-proto';

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

export const addBalancesToIpfs = async (_balances: BalancesMap<NumberType>) => {
  const balances = convertBalancesMap(_balances, BigIntify);
  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify(balances))
  });

  const result = await last(ipfsClient.addAll(files));
  if (result) {
    insertToDB(FETCHES_DB, {
      _id: `ipfs://${result.cid.toString()}`,
      fetchedAt: BigInt(Date.now()),
      content: balances,
      db: 'Balances',
      isPermanent: true
    });
    return result;
  } else {
    return undefined;
  }
}

export const addMetadataToIpfs = async (_collectionMetadata: Metadata<NumberType>, _individualBadgeMetadata: MetadataMap<NumberType>) => {
  const collectionMetadata = convertMetadata(_collectionMetadata, BigIntify);
  const individualBadgeMetadata = convertMetadataMap(_individualBadgeMetadata, BigIntify);

  const imageFiles = [];
  if (collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
    const blob = await dataUrlToFile(collectionMetadata.image);
    imageFiles.push({
      content: new Uint8Array(blob)
    });
  }

  for (const badge of Object.values(individualBadgeMetadata)) {
    if (badge?.metadata.image && badge?.metadata.image.startsWith('data:image')) {
      const blob = await dataUrlToFile(badge?.metadata.image);
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

    for (const badge of Object.values(individualBadgeMetadata)) {
      if (badge?.metadata.image && badge?.metadata.image.startsWith('data:image')) {
        const result = cids.shift();
        if (result) badge.metadata.image = 'ipfs://' + result;
      }
    }
  }

  const files: { path: string, content: Uint8Array }[] = [];
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

      await insertToDB(FETCHES_DB, {
        _id: `ipfs://${result.cid.toString()}/${file.path}`,
        fetchedAt: BigInt(Date.now()),
        content: i === 0 ? collectionMetadata : individualBadgeMetadata[metadataId]?.metadata,
        db: 'Metadata',
        isPermanent: true
      });
    }
  }


  return result;
}

export const addClaimToIpfs = async (name: string, description: string, leavesDetails: LeavesDetails[], hasPassword: boolean) => {
  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify({ name, description, challengeDetails: { leavesDetails }, hasPassword }))
  });

  const result = await last(ipfsClient.addAll(files));
  if (!result) return undefined;

  await insertToDB(FETCHES_DB, {
    _id: `ipfs://${result.cid.toString()}`,
    fetchedAt: BigInt(Date.now()),
    content: {
      name,
      description,
      challengeDetails: leavesDetails.map((leaf) => ({ leavesDetails: leaf })),
      hasPassword
    },
    db: 'Claim',
    isPermanent: true
  });

  return result;
}