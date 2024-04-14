import axiosApi from 'axios';
import { BitBadgesApiRoutes } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

const axios = axiosApi.create({
  withCredentials: true,
  headers: {
    'Content-type': 'application/json'
  },
  httpsAgent: agent
});
dotenv.config();

// const wallet = ethers.Wallet.createRandom();
// const address = wallet.address;

const BACKEND_URL = 'https://api.bitbadges.io';
// const session = JSON.stringify(createExampleReqForAddress(address).session);
const config = {
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.BITBADGES_API_KEY ?? ''
    // 'x-mock-session': session
  }
};

interface ApiBenchmarkDetails {
  name: string;
  description: string;
  route: string;
  body: any;
  // authentication?: boolean;
  // expectedStatus?: number;
  maxResponseTime?: number;
}

const NUM_RUNS_PER_BENCHMARK = 2;
const apiBenchmarks: ApiBenchmarkDetails[] = [
  {
    name: 'Get Address Lists - Reserved',
    description: 'Get address lists',
    route: BitBadgesApiRoutes.GetAddressListsRoute(),
    body: {
      listsToFetch: [
        {
          listId: 'All',
          viewsToFetch: []
        }
      ]
    },
    maxResponseTime: 5
  },
  {
    name: 'Get Address Lists - Not Reserved',
    description: 'Get address lists',
    route: BitBadgesApiRoutes.GetAddressListsRoute(),
    body: {
      listsToFetch: [
        {
          listId: 'sample-41acdb623fa09a2fcb4190aebdc22179d5901508538089a3610bbeec18a3a322',
          viewsToFetch: []
        }
      ]
    }
  }
];

for (const benchmark of apiBenchmarks) {
  let averageTime = 0;
  let maxTime = 0;
  for (let i = 0; i < NUM_RUNS_PER_BENCHMARK; i++) {
    const startTime = Date.now();
    const res = await axios.post(`${BACKEND_URL}${benchmark.route}`, benchmark.body, config);
    const responseTime = Number(res.headers['x-response-time']);
    if (res.status !== 200) {
      console.log(`Error: ${res.status}`);
      process.exit(1);
    }
    averageTime += responseTime;
    maxTime = Math.max(maxTime, responseTime);
    const endTime = Date.now();
    console.log(`Response Time: ${endTime - startTime} ms`);
  }

  averageTime /= NUM_RUNS_PER_BENCHMARK;

  console.log(`Benchmark: ${benchmark.name}`);
  console.log(`Average Time: ${averageTime} ms`);
  console.log(`Max Time: ${maxTime} ms`);
  if (benchmark.maxResponseTime && averageTime > benchmark.maxResponseTime) {
    console.log(`WARNING: Average time exceeded max expected time of ${benchmark.maxResponseTime} ms`);
  }
  console.log('----------------------------------');
}
