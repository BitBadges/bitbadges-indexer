import axiosApi from 'axios';
import { BitBadgesApiRoutes } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';

const axios = axiosApi.create({
  withCredentials: true,
  headers: {
    'Content-type': 'application/json'
  }
});
dotenv.config();

// const wallet = ethers.Wallet.createRandom();
// const address = wallet.address;

// const BACKEND_URL = 'https://api.bitbadges.io';
const BACKEND_URL = 'http://localhost:3001';
// const session = JSON.stringify(createExampleReqForAddress(address).session);
const config = {
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.BITBADGES_API_KEY ?? ''
    // 'x-mock-session': session
  },
  withCredentials: true
};

async function runBenchmark() {
  console.log('Starting benchmarks...');
  console.time('Total time');
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 1; i++) {
    const getFunc = async () => {
      console.time(`Benchmark ${i}`);
      const res = await axios.post(
        `${BACKEND_URL}${BitBadgesApiRoutes.GetCollectionsRoute()}`,
        {
          collectionsToFetch: [{ collectionId: '1', viewsToFetch: [{ viewId: 'asfdds', viewType: 'sdfsd', bookmark: 12 }] }]
        },
        config
      );
      const responseTime = Number(res.headers['x-response-time']);
      console.log(`Response time: ${responseTime}ms`);
      console.timeEnd(`Benchmark ${i}`);
    };

    promises.push(getFunc());
  }

  await Promise.all(promises);

  console.timeEnd('Total time');
}

runBenchmark();
