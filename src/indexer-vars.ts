import { S3 } from '@aws-sdk/client-s3';
import { create } from 'ipfs-http-client';

// Created a separate file bc for test cases, I did not want to trigger the poller / indexer but still needed access to these variables

export const OFFLINE_MODE = false;

export const s3 = new S3({
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  region: 'us-east-1',
  forcePathStyle: false, // Configures to use subdomain/virtual calling format.
  credentials: {
    accessKeyId: process.env.SPACES_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY ?? ''
  }
});

const auth = 'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

export const LOAD_BALANCER_ID = Number(process.env.LOAD_BALANCER_ID); // string number

export const ipfsClient = create({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: auth
  },
  timeout: process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000
});
