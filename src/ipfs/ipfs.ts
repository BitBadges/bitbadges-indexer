import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import { NumberType, deepCopy } from 'bitbadgesjs-proto';
import { ApprovalInfoDetails, BadgeMetadataDetails, BigIntify, ChallengeDetails, Metadata, OffChainBalancesMap, convertBadgeMetadataDetails, convertMetadata, convertOffChainBalancesMap } from 'bitbadgesjs-utils';
import crypto from 'crypto';
import last from 'it-last';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { AuthenticatedRequest } from '../blockin/blockin_handlers';
import { FetchModel, OffChainUrlModel, getFromDB, insertToDB } from '../db/db';
import { getStatus } from '../db/status';
import { ipfsClient, s3 } from "../indexer-vars";


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
      await insertToDB(FetchModel, {
        _legacyId: `ipfs://${result.cid.toString()}`,
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
      const urlDoc = await getFromDB(OffChainUrlModel, urlPath);
      if (!urlDoc || BigInt(urlDoc.collectionId) != BigInt(collectionId)) {
        throw new Error('The existing off-chain URL does not belong to this collection.');
      }
    }

    const params = {
      Body: binaryData,
      Bucket: 'bitbadges-balances',
      Key: 'balances/' + path,
      ACL: ObjectCannedACL.public_read,
      ContentType: 'application/json', // Set the content type to JSON
    };
    await s3.send(new PutObjectCommand(params));

    const location = 'https://bitbadges-balances.nyc3.digitaloceanspaces.com/balances/' + path;

    return { uri: location };
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


  const imageFiles = [];
  if (collectionMetadata && collectionMetadata.image && collectionMetadata.image.startsWith('data:')) {
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

  //We currently don't store the images in CouchDB, so we don't need to add them to FetchModel
  if (imageFiles.length > 0) {
    const promises = [];
    for (const imageFile of imageFiles) {
      promises.push(ipfsClient.add(imageFile));
    }

    const imageResults = await Promise.all(promises);
    const cids = imageResults.map(x => x.cid.toString());

    if (collectionMetadata && collectionMetadata.image && collectionMetadata.image.startsWith('data:')) {
      const result = cids.shift();
      if (result) {
        collectionMetadata.image = 'ipfs://' + result;
      }
    }

    for (const metadata of badgeMetadata) {
      if (metadata.image && metadata.image.startsWith('data:')) {
        const result = cids.shift();
        console.log(result);
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

  //Was being weird with .addAll so we are doing it one by one here...
  //Should probably look into it in the future
  const status = await getStatus();

  const promises = files.map(async (file, idx) => {
    const result = await ipfsClient.add(file);
    await insertToDB(FetchModel, {
      _legacyId: `ipfs://${result.cid.toString()}`,
      fetchedAt: BigInt(Date.now()),
      fetchedAtBlock: status.block.height,
      content: idx === 0 && collectionMetadata ? collectionMetadata : badgeMetadata[collectionMetadata ? idx - 1 : idx],
      db: 'Metadata',
      isPermanent: true,
    });

    return { cid: result.cid.toString() };
  });

  const promiseResults = await Promise.all(promises);

  const results = deepCopy(promiseResults);
  const collectionMetadataResult = collectionMetadata ? results.shift() : undefined;
  const badgeMetadataResults = results;


  return { allResults: promiseResults, collectionMetadataResult, badgeMetadataResults };
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
  await insertToDB(FetchModel, {
    _legacyId: `ipfs://${result.cid.toString()}`,
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