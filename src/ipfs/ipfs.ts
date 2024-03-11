import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import {
  ApprovalInfoDetails,
  ChallengeDetails,
  FetchDoc,
  type NumberType,
  type iBadgeMetadataDetails,
  type iChallengeDetails,
  type iMetadata,
  type iOffChainBalancesMap
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import last from 'it-last';
import { TextDecoder } from 'node:util';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { getFromDB, insertToDB } from '../db/db';
import { FetchModel, OffChainUrlModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { ipfsClient, s3 } from '../indexer-vars';

export const getFromIpfs = async (path: string): Promise<{ file: string }> => {
  if (!path) return { file: '{}' };

  const getRes = ipfsClient.cat(path);

  // Make sure fetch doesn't take longer than timeout

  const timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 10000;

  const timeoutPromise = new Promise((resolve, reject) =>
    setTimeout(() => {
      reject(new Error('Fetch operation timed out'));
    }, timeout)
  );

  const decoder = new TextDecoder();
  let fileContents = '';
  const fetchPromise = (async () => {
    // Do not exceed FETCH_TIMEOUT

    // start timer
    const start = Date.now();

    for await (const file of getRes) {
      if (Date.now() - start > timeout) {
        throw new Error('Fetch operation timed out');
      }

      const chunk = decoder.decode(file);
      fileContents += chunk;
    }

    return { file: fileContents };
  })();

  const res = await Promise.race([fetchPromise, timeoutPromise]);
  return res as { file: string };
};

export async function dataUrlToFile(dataUrl: string): Promise<ArrayBuffer> {
  const res = await axios.get(dataUrl, { responseType: 'arraybuffer' });
  const blob = res.data;
  return blob;
}

export const addBalancesToOffChainStorage = async (
  balances: iOffChainBalancesMap<NumberType>,
  method: 'ipfs' | 'centralized',
  collectionId: NumberType,
  urlPath?: string
) => {
  if (method === 'ipfs') {
    const files = [];
    files.push({
      path: '',
      content: uint8ArrayFromString(JSON.stringify(balances))
    });

    const status = await getStatus();

    const result = await last(ipfsClient.addAll(files));
    if (result) {
      await insertToDB(
        FetchModel,
        new FetchDoc({
          _docId: `ipfs://${result.cid.toString()}`,
          fetchedAt: BigInt(Date.now()),
          fetchedAtBlock: status.block.height,
          content: balances,
          db: 'Balances',
          isPermanent: true
        })
      );
      return { cid: result.cid.toString() };
    } else {
      return undefined;
    }
  } else {
    const binaryData = JSON.stringify(balances);
    const randomBytes = crypto.randomBytes(32);
    const path = BigInt(collectionId) > 0 ? urlPath : randomBytes.toString('hex');
    if (BigInt(collectionId) > 0 && !urlPath) {
      throw new Error('Could not resolve urlPath when updating an existing off-chain URL');
    } else if (BigInt(collectionId) > 0 && urlPath) {
      const urlDoc = await getFromDB(OffChainUrlModel, urlPath);
      if (!urlDoc || BigInt(urlDoc.collectionId) !== BigInt(collectionId)) {
        throw new Error(
          'The existing off-chain URL does not belong to this collection. We only allow the first collection defined on-chain with this URL to update it.'
        );
      }
    }

    const params = {
      Body: binaryData,
      Bucket: 'bitbadges-balances',
      Key: 'balances/' + path,
      ACL: ObjectCannedACL.public_read,
      ContentType: 'application/json' // Set the content type to JSON
    };
    await s3.send(new PutObjectCommand(params));

    const location = 'https://bitbadges-balances.nyc3.digitaloceanspaces.com/balances/' + path;

    return { uri: location };
  }
};

export const addMetadataToIpfs = async (
  collectionMetadata?: iMetadata<NumberType>,
  _individualBadgeMetadata?: Array<iBadgeMetadataDetails<NumberType>> | Array<iMetadata<NumberType>>
) => {
  const badgeMetadata: Array<iMetadata<NumberType>> = [];
  if (_individualBadgeMetadata) {
    for (const item of _individualBadgeMetadata) {
      const currItemCastedAsDetails = item as iBadgeMetadataDetails<NumberType>;
      const currItemCastedAsMetadata = item as iMetadata<NumberType>;

      let badgeMetadataItem;
      if (currItemCastedAsDetails.metadata) {
        badgeMetadataItem = currItemCastedAsDetails.metadata;
      } else {
        badgeMetadataItem = currItemCastedAsMetadata;
      }
      badgeMetadata.push(badgeMetadataItem);
    }
  }

  const imageFiles = [];
  if (collectionMetadata?.image && collectionMetadata.image.startsWith('data:')) {
    const blob = await dataUrlToFile(collectionMetadata.image);
    imageFiles.push({
      content: new Uint8Array(blob)
    });
  }

  for (const metadata of badgeMetadata) {
    if (metadata.image && metadata.image.startsWith('data:')) {
      const blob = await dataUrlToFile(metadata.image);
      imageFiles.push({
        content: new Uint8Array(blob)
      });
    }
  }

  if (imageFiles.length > 0) {
    const promises = [];
    for (const imageFile of imageFiles) {
      promises.push(ipfsClient.add(imageFile));
    }

    const imageResults = await Promise.all(promises);
    const cids = imageResults.map((x) => x.cid.toString());

    if (collectionMetadata?.image && collectionMetadata.image.startsWith('data:')) {
      const result = cids.shift();
      if (result) {
        collectionMetadata.image = 'ipfs://' + result;
      }
    }

    for (const metadata of badgeMetadata) {
      if (metadata.image && metadata.image.startsWith('data:')) {
        const result = cids.shift();
        if (result) metadata.image = 'ipfs://' + result;
      }
    }
  }

  const files: Array<{ path?: string; content: Uint8Array; name?: string }> = [];
  if (collectionMetadata) {
    files.push({
      content: uint8ArrayFromString(JSON.stringify(collectionMetadata))
    });
  }

  for (const metadata of badgeMetadata) {
    files.push({
      content: uint8ArrayFromString(JSON.stringify(metadata))
    });
  }

  // Was being weird with .addAll so we are doing it one by one here...
  // Should probably look into it in the future
  const status = await getStatus();

  const promises = files.map(async (file, idx) => {
    const result = await ipfsClient.add(file);
    await insertToDB(
      FetchModel,
      new FetchDoc({
        _docId: `ipfs://${result.cid.toString()}`,
        fetchedAt: BigInt(Date.now()),
        fetchedAtBlock: status.block.height,
        content: idx === 0 && collectionMetadata ? collectionMetadata : badgeMetadata[collectionMetadata ? idx - 1 : idx],
        db: 'Metadata',
        isPermanent: true
      })
    );

    return { cid: result.cid.toString() };
  });

  const promiseResults = await Promise.all(promises);

  const collectionMetadataResult = collectionMetadata ? promiseResults.shift() : undefined;
  const badgeMetadataResults = promiseResults;

  return { collectionMetadataResult, badgeMetadataResults };
};

export const addApprovalDetailsToOffChainStorage = async <T extends NumberType>(
  name: string,
  description: string,
  challengeDetails?: iChallengeDetails<T>
) => {
  // Remove preimages and passwords from challengeDetails
  let convertedDetails: ChallengeDetails<T> | undefined;

  if (challengeDetails) {
    convertedDetails = new ChallengeDetails<T>({
      ...challengeDetails,
      leavesDetails: {
        ...challengeDetails.leavesDetails,
        preimages: undefined,
        seedCode: undefined
      }
    });
  }

  const files = [];
  files.push({
    path: '',
    content: uint8ArrayFromString(JSON.stringify({ name, description, challengeDetails: convertedDetails }))
  });

  const result = await last(ipfsClient.addAll(files));
  if (!result) return undefined;

  const status = await getStatus();

  const content = new ApprovalInfoDetails({
    name,
    description,
    challengeDetails: convertedDetails
  });

  await insertToDB(
    FetchModel,
    new FetchDoc<NumberType>({
      _docId: `ipfs://${result.cid.toString()}`,
      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: status.block.height,
      content,
      db: 'ApprovalInfo',
      isPermanent: true
    })
  );

  return result;
};
