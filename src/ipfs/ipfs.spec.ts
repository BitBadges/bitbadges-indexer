import { Metadata } from 'bitbadgesjs-sdk';
import { addMetadataToIpfs, getFromIpfs } from './ipfs'; // Import your module and types
import mongoose from 'mongoose';
import { MongoDB } from '../db/db';
import { server } from '../indexer';
import { connectToRpc } from '../poll';

describe('addMetadataToIpfs', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}

    await connectToRpc();
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(console.error);
    // shut down server
    server?.close();
  });

  it('should add collection metadata to IPFS', async () => {
    // Arrange
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: ''
    });

    // // Act
    const result = await addMetadataToIpfs([collectionMetadata, collectionMetadata, collectionMetadata]);
    const resultObj = { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' };

    expect(result).toEqual({
      results: [resultObj, resultObj, resultObj]
    });
  }, 30000);

  it('should work with just collection metadata', async () => {
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: ''
    });

    const result = await addMetadataToIpfs([collectionMetadata]);
    expect(result.results).toEqual([
      {
        cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB',
        uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB'
      }
    ]);
  }, 30000);

  it('should work with just badge metadata', async () => {
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: ''
    });

    const result = await addMetadataToIpfs([collectionMetadata, collectionMetadata, collectionMetadata]);
    expect(result.results).toEqual([
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' },
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' },
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' }
    ]);
  }, 30000);

  it('should work with no metadata', async () => {
    const result = await addMetadataToIpfs();

    expect(result).toEqual({ results: [] });
  }, 30000);

  it('should work with an image', async () => {
    // Arrange
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAk'
    });
    const result = await addMetadataToIpfs([collectionMetadata]);
    const cid = result.results[0]?.cid;
    if (!cid) {
      throw new Error('No CID');
    }

    const res: any = await getFromIpfs(cid ?? '');
    if (!res) {
      throw new Error('No result');
    }

    console.log(res);
    console.log(res.file);
    console.log(res.file.image);

    const metadata = JSON.parse(res.file);

    expect(metadata.image.startsWith('ipfs://')).toBeTruthy();

    const imageRes: any = await getFromIpfs(metadata.image.replace('ipfs://', ''));
    if (!imageRes) {
      throw new Error('No image result');
    }
  }, 30000);
});
