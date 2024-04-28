import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import {
  ChallengeDetails,
  FetchDoc,
  iCollectionMetadataDetails,
  type NumberType,
  type iBadgeMetadataDetails,
  type iChallengeDetails,
  type iMetadata,
  type iOffChainBalancesMap
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { TextDecoder } from 'node:util';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { getFromDB, getManyFromDB, insertToDB } from '../db/db';
import { DigitalOceanBalancesModel, FetchModel, OffChainUrlModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { ipfsClient, s3 } from '../indexer-vars';

export const getFromIpfs = async (path: string): Promise<{ file: string }> => {
  if (!path) return { file: '{}' };

  const getRes = ipfsClient.cat(path);

  // Make sure fetch doesn't take longer than timeout

  const decoder = new TextDecoder();
  let fileContents = '';
  const fetchPromise = (async () => {
    for await (const file of getRes) {
      const chunk = decoder.decode(file);
      fileContents += chunk;
    }

    return { file: fileContents };
  })();

  const res = await fetchPromise;
  return res as { file: string };
};

export async function dataUrlToFile(dataUrl: string): Promise<ArrayBuffer> {
  const res = await axios.get(dataUrl, { responseType: 'arraybuffer' });
  const blob = res.data;
  return blob;
}

export async function addToIpfs({
  data,
  db,
  skipCache = false
}: {
  data: { path: string; content: string | Uint8Array }[];
  db: 'ApprovalInfo' | 'Metadata' | 'Balances' | 'ChallengeInfo';
  skipCache?: boolean;
}) {
  if (data.length === 0) return [];

  const results: { cid: string; uri: string }[] = [];
  const promises = [];

  const docIdsToFetch = [];
  for (const { path, content } of data) {
    const uint8Content = typeof content === 'string' ? uint8ArrayFromString(content) : content;
    const hashResult = await ipfsClient.add({ path, content: uint8Content }, { onlyHash: true });
    const hash = hashResult.cid.toString();
    docIdsToFetch.push(`ipfs://${hash}`);
  }

  const fetchDocs = await getManyFromDB(FetchModel, docIdsToFetch);

  for (let i = 0; i < data.length; i++) {
    const fetchDoc = fetchDocs[i];
    const { path, content } = data[i];
    const uint8Content = typeof content === 'string' ? uint8ArrayFromString(content) : content;
    const existingDoc = fetchDoc;
    if (existingDoc) {
      const hash = existingDoc._docId.split('ipfs://')[1];
      promises.push(Promise.resolve({ cid: hash }));
      continue;
    }
    promises.push(ipfsClient.add({ path, content: uint8Content }));
  }

  const ipfsResults = await Promise.all(promises);
  const fetchDocPromises = [];
  const status = await getStatus();
  for (let i = 0; i < ipfsResults.length; i++) {
    const result = ipfsResults[i];
    if (result.cid) {
      results.push({ cid: result.cid.toString(), uri: `ipfs://${result.cid.toString()}` });
      if (!skipCache) {
        const contentToStore = JSON.parse(data[i].content as string);

        fetchDocPromises.push(
          insertToDB(
            FetchModel,
            new FetchDoc({
              _docId: `ipfs://${result.cid.toString()}`,
              fetchedAt: BigInt(Date.now()),
              fetchedAtBlock: status.block.height,
              content: contentToStore,
              db,
              isPermanent: true
            })
          )
        );
      }
    } else {
      results.push({ cid: '', uri: '' });
    }
  }

  await Promise.all(fetchDocPromises);

  return results;
}

export const addBalancesToOffChainStorage = async (
  balances: iOffChainBalancesMap<NumberType>,
  method: 'ipfs' | 'centralized',
  collectionId: NumberType,
  urlPath?: string
) => {
  if (method === 'ipfs') {
    const results = await addToIpfs({ data: [{ path: '', content: JSON.stringify(balances) }], db: 'Balances' });
    return results[0];
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

    //TODO: We should probably handle this better on genesis (collectionId = 0)
    // We have two cases we are trying tohandle here:
    //  1. User creates collection w/ balances manually defined -> we don't need the doc at all (currently) bc its only used for reproducing claims
    //  2. User creates collection w/ claims -> balances will be blank until the first claim is made (then this gets added)
    if (BigInt(collectionId) > 0) {
      await insertToDB(DigitalOceanBalancesModel, {
        _docId: Number(collectionId).toString(),
        balances: balances
      });
    }

    const location = 'https://bitbadges-balances.nyc3.digitaloceanspaces.com/balances/' + path;

    return { uri: location };
  }
};

export const addMetadataToIpfs = async (
  _metadata?: Array<iBadgeMetadataDetails<NumberType>> | Array<iMetadata<NumberType> | iCollectionMetadataDetails<NumberType>>
) => {
  const metadataArr: Array<iMetadata<NumberType>> = [];
  if (_metadata) {
    for (const item of _metadata) {
      const currItemCastedAsDetails = item as iBadgeMetadataDetails<NumberType>;
      const currItemCastedAsMetadata = item as iMetadata<NumberType>;

      let badgeMetadataItem;
      if (currItemCastedAsDetails.metadata) {
        badgeMetadataItem = currItemCastedAsDetails.metadata;
      } else {
        badgeMetadataItem = currItemCastedAsMetadata;
      }
      metadataArr.push(badgeMetadataItem);
    }
  }

  const imagesToUpload = metadataArr.filter((x) => x.image && x.image.startsWith('data:'));
  const imageFiles = [];
  for (const metadata of imagesToUpload) {
    const blob = await dataUrlToFile(metadata.image);
    imageFiles.push({
      content: new Uint8Array(blob)
    });
  }
  const imageResults = await addToIpfs({
    data: imageFiles.map((x) => ({ path: '', content: x.content })),
    db: 'Metadata',
    skipCache: true
  });
  const metadataWithImages = metadataArr.map((x) => {
    if (x.image && x.image.startsWith('data:')) {
      const result = imageResults.shift();
      if (result) x.image = 'ipfs://' + result.cid;
    }
    return x;
  });

  const results = await addToIpfs({ data: metadataWithImages.map((x) => ({ path: '', content: JSON.stringify(x) })), db: 'Metadata' });
  return { results };
};

export const addApprovalDetailsToOffChainStorage = async <T extends NumberType>(
  name: string,
  description: string,
  challengeDetails?: iChallengeDetails<T>[]
): Promise<[string, string[]] | undefined> => {
  // Remove preimages and passwords from challengeDetails
  let convertedDetails: ChallengeDetails<T>[] | undefined;

  if (challengeDetails) {
    convertedDetails = challengeDetails.map((challengeDetail) => {
      return new ChallengeDetails<T>({
        ...challengeDetail,
        preimages: undefined,
        seedCode: undefined
      });
    });
  }

  const metadataResults = await addToIpfs({ data: [{ path: '', content: JSON.stringify({ name, description }) }], db: 'ApprovalInfo' });
  const metadataResult = metadataResults[0];
  if (!metadataResult) return undefined;

  if (convertedDetails) {
    const results = await addToIpfs({
      data: convertedDetails.map((x) => ({
        path: '',
        content: JSON.stringify(x)
      })),
      db: 'ChallengeInfo'
    });

    return [metadataResult.cid.toString(), results.map((x) => x.cid.toString())];
  } else {
    return [metadataResult.cid.toString(), []];
  }
};
