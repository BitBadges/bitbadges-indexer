import AWS from 'aws-sdk'
import { create } from 'ipfs-http-client'


//Created a separate file bc for test cases, I did not want to trigger the poller / indexer but still needed access to these variables

export const OFFLINE_MODE = false;

export const TIME_MODE = process.env.TIME_MODE === 'true' || false;

const spacesEndpoint = new AWS.Endpoint('nyc3.digitaloceanspaces.com'); // replace 'nyc3' with your Spaces region if different
export const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
  secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY
});

const auth = 'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

export const LOAD_BALANCER_ID = Number(process.env.LOAD_BALANCER_ID); //string number

export const ipfsClient = create({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: auth,
  },
  timeout: process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000,
});
