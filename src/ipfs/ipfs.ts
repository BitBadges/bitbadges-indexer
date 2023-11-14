import axios from 'axios';
import { NumberType } from 'bitbadgesjs-proto';
import { BadgeMetadataDetails, BigIntify, ChallengeDetails, ApprovalInfoDetails, Metadata, OffChainBalancesMap, convertBadgeMetadataDetails, convertMetadata, convertOffChainBalancesMap } from 'bitbadgesjs-utils';
import last from 'it-last';
import { getStatus } from '../db/status';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { FETCHES_DB, OFF_CHAIN_URLS_DB, insertToDB } from '../db/db';
import { ipfsClient, s3 } from "../indexer";
import crypto from 'crypto';
import { AuthenticatedRequest } from '../blockin/blockin_handlers';
import { catch404 } from '../utils/couchdb-utils';


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
      //Do not exceed FETCH_TIMEOUT

      //start timer
      const start = Date.now();

      for await (const file of getRes) {
        if (Date.now() - start > timeout) {
          throw new Error('Fetch operation timed out');
        }

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

export const addBalancesToOffChainStorage = async (_balances: OffChainBalancesMap<NumberType>, method: 'ipfs' | 'centralized', collectionId: NumberType, req: AuthenticatedRequest<NumberType>, urlPath?: string) => {
  const balances = convertOffChainBalancesMap(_balances, BigIntify);

  if (method === 'ipfs') {
    const files = [];
    files.push({
      path: '',
      content: uint8ArrayFromString(JSON.stringify(balances))
    });

    const status = await getStatus();

    const result = await last(ipfsClient.addAll(files));
    if (result) {
      await insertToDB(FETCHES_DB, {
        _id: `ipfs://${result.cid.toString()}`,
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: status.block.height,
        content: balances,
        db: 'Balances',
        isPermanent: true
      });
      return { cid: result.cid.toString() };
    } else {
      return undefined;
    }
  } else {


    const balances = convertOffChainBalancesMap(_balances, BigIntify);
    const binaryData = JSON.stringify(balances);

    const randomBytes = crypto.randomBytes(32);
    const path = BigInt(collectionId) > 0 ? urlPath : randomBytes.toString('hex');
    if (BigInt(collectionId) > 0 && !urlPath) {
      throw new Error('Could not resolve urlPath when updating an existing off-chain URL');
    } else if (BigInt(collectionId) > 0 && urlPath) {
      const urlDoc = await OFF_CHAIN_URLS_DB.get(urlPath).catch(catch404);
      if (!urlDoc || BigInt(urlDoc.collectionId) != BigInt(collectionId)) {
        throw new Error('The existing off-chain URL does not belong to this collection.');
      }
    }

    const params = {
      Body: binaryData,
      Bucket: 'bitbadges',
      Key: 'balances/' + path,
      ACL: 'public-read', // Set the ACL as needed
      ContentType: 'application/json', // Set the content type to JSON
    };
    const res = await s3.upload(params).promise();

    return { uri: res.Location };
  }
}

//TODO: parallelize this?
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
      content: uint8ArrayFromString(JSON.stringify(collectionMetadata)),
    });
  }

  for (const metadata of badgeMetadata) {
    files.push(
      {
        content: uint8ArrayFromString(JSON.stringify(metadata)),
      }
    );
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

export const addApprovalDetailsToOffChainStorage = async (name: string, description: string, challengeDetails?: ChallengeDetails<bigint>) => {
  const hasPassword = challengeDetails && challengeDetails.password && challengeDetails.password.length > 0;

  //Remove preimages and passwords from challengeDetails
  let convertedDetails: ChallengeDetails<bigint> | undefined = undefined;

  if (challengeDetails) {
    convertedDetails = {
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
    content: uint8ArrayFromString(JSON.stringify({ name, description, challengeDetails: convertedDetails }))
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
      challengeDetails: convertedDetails,
    } as ApprovalInfoDetails<bigint>,
    db: 'ApprovalInfo',
    isPermanent: true
  });

  return result;
}