import axios from 'axios';
import { NumberType } from 'bitbadgesjs-proto';
import { BadgeMetadataDetails, BigIntify, ChallengeDetails, MerkleChallengeDetails, Metadata, OffChainBalancesMap, convertBadgeMetadataDetails, convertMetadata, convertOffChainBalancesMap } from 'bitbadgesjs-utils';
import last from 'it-last';
import { getStatus } from '../db/status';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { FETCHES_DB, insertToDB } from '../db/db';
import { ipfsClient } from "../indexer";

export const getFromIpfs = async (path: string) => {
  if (!path) return { file: '{}' }

  const getRes = ipfsClient.cat(path);

  //Make sure fetch doesn't take longer than timeout

  const timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 10000;

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Fetch operation timed out')), timeout)
  );

  try {
    const decoder = new TextDecoder();
    let fileContents = '';
    const fetchPromise = (async () => {
      for await (const file of getRes) {
        let chunk = decoder.decode(file);
        fileContents += chunk;
      }

      return { file: fileContents };
    })();

    const res = await Promise.race([fetchPromise, timeoutPromise]);
    return res;
  } catch (e) {
    throw e;
  }
}

export async function dataUrlToFile(dataUrl: string): Promise<ArrayBuffer> {
  const res = await axios.get(dataUrl, { responseType: 'arraybuffer' });
  const blob = res.data;
  return blob
}

export const addBalancesToIpfs = async (_balances: OffChainBalancesMap<NumberType>) => {
  const balances = convertOffChainBalancesMap(_balances, BigIntify);
  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify(balances))
  });

  const result = await last(ipfsClient.addAll(files));
  if (result) {
    //TODO: We should be able to cache it here, but if we do, then in metadata-queue.ts, it sees fetchDoc = truthy and never calls await handleBalances()
    // Keeping it commented out for now

    // insertToDB(FETCHES_DB, {
    //   _id: `ipfs://${result.cid.toString()}`,
    //   fetchedAt: BigInt(Date.now()),
    //   content: balances,
    //   db: 'Balances',
    //   isPermanent: true
    // });
    return { cid: result.cid.toString() };
  } else {
    return undefined;
  }
}

export const addMetadataToIpfs = async (_collectionMetadata?: Metadata<NumberType>, _individualBadgeMetadata?: BadgeMetadataDetails<NumberType>[] | Metadata<NumberType>[]) => {
  const collectionMetadata = _collectionMetadata ? convertMetadata(_collectionMetadata, BigIntify) : undefined;
  const badgeMetadata: Metadata<NumberType>[] = [];
  if (_individualBadgeMetadata) {
    for (const item of _individualBadgeMetadata) {
      let currItemCastedAsDetails = item as BadgeMetadataDetails<NumberType>;
      let currItemCastedAsMetadata = item as Metadata<NumberType>;

      let badgeMetadataItem;
      if (currItemCastedAsDetails.metadata) {
        badgeMetadataItem = convertBadgeMetadataDetails(currItemCastedAsDetails, BigIntify).metadata;
      } else {
        badgeMetadataItem = convertMetadata(currItemCastedAsMetadata, BigIntify);
      }
      badgeMetadata.push(badgeMetadataItem);
    }
  }

  const results = [];
  let collectionMetadataResult = undefined;
  const badgeMetadataResults = [];

  const imageFiles = [];
  if (collectionMetadata && collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
    const blob = await dataUrlToFile(collectionMetadata.image);
    imageFiles.push({
      content: new Uint8Array(blob)
    });
  }

  for (const metadata of badgeMetadata) {
    if (metadata.image && metadata.image.startsWith('data:image')) {
      const blob = await dataUrlToFile(metadata.image);
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
      results.push({ cid: imageResult.cid.toString() });
    }

    if (collectionMetadata && collectionMetadata.image && collectionMetadata.image.startsWith('data:image')) {
      const result = cids.shift();
      if (result) {
        collectionMetadata.image = 'ipfs://' + result;
      }
    }

    for (const metadata of badgeMetadata) {
      if (metadata.image && metadata.image.startsWith('data:image')) {
        const result = cids.shift();
        if (result) metadata.image = 'ipfs://' + result;
      }
    }
  }

  const files: { path?: string, content: Uint8Array, name?: string }[] = [];
  if (collectionMetadata) {
    files.push({
      // path: 'collection',
      content: uint8ArrayFromString(JSON.stringify(collectionMetadata)),
      // name: 'collection'
    });
  }

  // let i = 0;

  for (const metadata of badgeMetadata) {
    files.push(
      {
        // path: 'badges-' + i,
        content: uint8ArrayFromString(JSON.stringify(metadata)),
        // name: 'badges-' + i
      }
    );
    // i++;
  }

  const metadataResults = ipfsClient.addAll(files);

  const status = await getStatus();
  let idx = 0;
  for await (const result of metadataResults) {
    results.push({ cid: result.cid.toString() });

    if (result) {
      if (idx === 0 && collectionMetadata) {
        collectionMetadataResult = { cid: result.cid.toString() };
      } else {
        badgeMetadataResults.push({ cid: result.cid.toString() });
      }

      await insertToDB(FETCHES_DB, {
        _id: `ipfs://${result.cid.toString()}`,
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: status.block.height,
        content: idx === 0 && collectionMetadata ? collectionMetadata : badgeMetadata[collectionMetadata ? idx - 1 : idx],
        db: 'Metadata',
        isPermanent: true
      });
    }
    idx++;
  }

  return { allResults: results, collectionMetadataResult, badgeMetadataResults };
}

export const addMerkleChallengeToIpfs = async (name: string, description: string, challengeDetails?: ChallengeDetails<bigint>) => {

  const hasPassword = challengeDetails && challengeDetails.password && challengeDetails.password.length > 0;

  //Remove preimages and passwords from challengeDetails
  let convertedChallengeDetails: ChallengeDetails<bigint> | undefined = undefined;

  if (challengeDetails) {
    convertedChallengeDetails = {
      ...challengeDetails,
      password: undefined,
      leavesDetails: {
        ...challengeDetails.leavesDetails,
        preimages: undefined
      }
    }
  }

  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify({ name, description, challengeDetails: convertedChallengeDetails }))
  });

  const result = await last(ipfsClient.addAll(files));
  if (!result) return undefined;

  const status = await getStatus();
  await insertToDB(FETCHES_DB, {
    _id: `ipfs://${result.cid.toString()}`,
    fetchedAt: BigInt(Date.now()),
    fetchedAtBlock: status.block.height,
    content: {
      name,
      description,
      hasPassword,
      challengeDetails: convertedChallengeDetails,
    } as MerkleChallengeDetails<bigint>,
    db: 'MerkleChallenge',
    isPermanent: true
  });

  return result;
}