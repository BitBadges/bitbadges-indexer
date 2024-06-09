// Up here so the env vars are set before the app is imported
process.env.DISABLE_API = 'false';
process.env.DISABLE_URI_POLLER = 'false';
process.env.DISABLE_BLOCKCHAIN_POLLER = 'false';
process.env.DISABLE_NOTIFICATION_POLLER = 'true';
process.env.TEST_MODE = 'true';

import app from './indexer';

import dotenv from 'dotenv';
import Moralis from 'moralis';
import { MongoDB } from './db/db';
import { connectToRpc } from './poll';
import { client } from './indexer-vars';
// import { connectToRpc } from './poll';
dotenv.config();

// Re override the dotenv vars
process.env.DISABLE_API = 'false';
process.env.DISABLE_URI_POLLER = 'false';
process.env.DISABLE_BLOCKCHAIN_POLLER = 'false';
process.env.DISABLE_NOTIFICATION_POLLER = 'true';
process.env.TEST_MODE = 'true';

// jest.setup.js
module.exports = async () => {
  console.log('jest.setup.js');
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });

  // Ensure MongoDB is ready before proceeding

  while (!MongoDB.readyState) {
    console.log('Waiting for MongoDB to be ready...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await connectToRpc();

  (global as any).app = app;
  (global as any).moralis = Moralis;
  (global as any).client = client;
  console.log('jest.setup.js done');

  console.log('app', !!app);
};
