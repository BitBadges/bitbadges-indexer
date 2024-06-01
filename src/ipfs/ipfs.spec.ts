import { Metadata } from 'bitbadgesjs-sdk';
import { addMetadataToIpfs, getFromIpfs } from './ipfs'; // Import your module and types

describe('addMetadataToIpfs', () => {
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

    expect(result).toEqual([resultObj, resultObj, resultObj]);
  }, 30000);

  it('should work with just collection metadata', async () => {
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: ''
    });

    const result = await addMetadataToIpfs([collectionMetadata]);
    expect(result).toEqual([
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
    expect(result).toEqual([
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' },
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' },
      { cid: 'QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB', uri: 'ipfs://QmUGizWbuiQfCrc3HNcmWMJwDHBA4AiYLQe97Jjx2jhcpB' }
    ]);
  }, 30000);

  it('should work with no metadata', async () => {
    const result = await addMetadataToIpfs();

    expect(result).toEqual([]);
  }, 30000);

  it('should work with an image', async () => {
    // Arrange
    const collectionMetadata = new Metadata<number>({
      name: 'Collection 1',
      description: 'Description 1',
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAk'
    });
    const results = await addMetadataToIpfs([collectionMetadata]);
    const cid = results[0]?.cid;
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
