import axiosApi from 'axios';
import { BitBadgesApiRoutes, GetAccountsBody, GetCollectionsBody, GetSearchBody } from 'bitbadgesjs-sdk';
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
// const BACKEND_URL = 'https://localhost:3001';
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
  type?: 'collection' | 'account' | 'addressList';
  options?: {
    tryAllCollections?: boolean;
  };
  // authentication?: boolean;
  // expectedStatus?: number;
  maxResponseTime?: number;
}

const NUM_RUNS_PER_BENCHMARK = 2;
const TRY_ALL_COLLECTIONS = false;

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
    maxResponseTime: 12
  },
  // {
  //   name: 'Get Address Lists - Not Reserved',
  //   description: 'Get address lists',
  //   route: BitBadgesApiRoutes.GetAddressListsRoute(),
  //   body: {
  //     listsToFetch: [
  //       {
  //         listId: 'sample-41acdb623fa09a2fcb4190aebdc22179d5901508538089a3610bbeec18a3a322',
  //         viewsToFetch: [
  //           {
  //             viewId: 'sample-41acdb623fa09a2fcb4190aebdc22179d5901508538089a3610bbeec18a3a322',
  //             viewType: 'listActivity',
  //             bookmark: ''
  //           }
  //         ]
  //       }
  //     ]
  //   }
  // },
  {
    name: 'Browse - Featured',
    description: 'Get featured collections and profiles',
    route: BitBadgesApiRoutes.GetBrowseCollectionsRoute(),
    body: {}
  },
  {
    name: 'Get user with ENS avatar',
    description: 'Get user with ENS avatar',
    route: BitBadgesApiRoutes.GetAccountsRoute(),
    body: {
      accountsToFetch: [
        {
          address: '0xE12BB245AE1398568d007E82bAC622f555f2B07F',
          fetchBalance: true,
          fetchSequence: true
        }
      ]
    } as GetAccountsBody
  },
  {
    name: 'Get user without ENS avatar',
    description: 'Get user with ENS avatar',
    route: BitBadgesApiRoutes.GetAccountsRoute(),
    body: {
      accountsToFetch: [
        {
          address: '0xb246a3764d642BABbd6b075bca3e77E1cD563d78',
          fetchBalance: true,
          fetchSequence: true
        }
      ]
    } as GetAccountsBody
  },
  {
    name: 'Get collection',
    description: 'Get collection',
    type: 'collection',
    options: {
      tryAllCollections: true
    },
    route: BitBadgesApiRoutes.GetCollectionsRoute(),
    body: {
      collectionsToFetch: [
        {
          collectionId: '1',
          metadataToFetch: [
            {
              badgeIds: [{ start: 1n, end: 10n }]
            }
          ]
        }
      ]
    } as GetCollectionsBody
  },
  {
    name: 'Get collection w/ activity',
    description: 'Get collection w/ activity',
    type: 'collection',
    options: {
      tryAllCollections: true
    },
    route: BitBadgesApiRoutes.GetCollectionsRoute(),
    body: {
      collectionsToFetch: [
        {
          collectionId: '8',
          viewsToFetch: [
            {
              viewType: 'transferActivity',
              viewId: 'transferActivity',
              bookmark: ''
            }
          ]
        }
      ]
    } as GetCollectionsBody
  },
  {
    name: 'Get collection w/ owners',
    description: 'Get collection w/ owners',
    type: 'collection',
    options: {
      tryAllCollections: true
    },
    route: BitBadgesApiRoutes.GetCollectionsRoute(),
    body: {
      collectionsToFetch: [
        {
          collectionId: '8',
          viewsToFetch: [
            {
              viewType: 'owners',
              viewId: 'owners',
              bookmark: ''
            }
          ]
        }
      ]
    } as GetCollectionsBody
  },
  {
    name: 'Get account w/ all views',
    description: 'Get account w/ all views',
    route: BitBadgesApiRoutes.GetAccountsRoute(),
    body: {
      accountsToFetch: [
        {
          address: '0xb246a3764d642BABbd6b075bca3e77E1cD563d78',
          fetchBalance: true,
          fetchSequence: true,
          viewsToFetch: [
            {
              viewType: 'badgesCollected',
              viewId: 'badgesCollected',
              bookmark: ''
            },
            {
              viewType: 'transferActivity',
              viewId: 'transferActivity',
              bookmark: ''
            },
            {
              viewType: 'listsActivity',
              viewId: 'listsActivity',
              bookmark: ''
            },
            {
              viewType: 'reviews',
              viewId: 'reviews',
              bookmark: ''
            },
            {
              viewType: 'allLists',
              viewId: 'allLists',
              bookmark: ''
            },
            {
              viewType: 'whitelists',
              viewId: 'whitelists',
              bookmark: ''
            },
            {
              viewType: 'blacklists',
              viewId: 'blacklists',
              bookmark: ''
            }
            // {
            //   viewType: 'claimAlerts',
            //   viewId: 'claimAlerts',
            //   bookmark: ''
            // },
            // {
            //   viewType: 'siwbbRequests',
            //   viewId: 'siwbbRequests',
            //   bookmark: ''
            // },
            // {
            //   viewType: 'createdSecrets',
            //   viewId: 'createdSecrets',
            //   bookmark: ''
            // },
            // {
            //   viewType: 'receivedSecrets',
            //   viewId: 'receivedSecrets',
            //   bookmark: ''
            // }
          ]
        }
      ]
    } as GetAccountsBody
  },
  {
    name: 'Search names',
    description: 'Search names',
    route: BitBadgesApiRoutes.GetSearchRoute('trev'),
    body: {} as GetSearchBody
  },
  {
    name: 'Search IDs',
    description: 'Search IDs',
    route: BitBadgesApiRoutes.GetSearchRoute('1'),
    body: {} as GetSearchBody
  },
  {
    name: 'Search non-ENS name',
    description: 'Search non-ENS name',
    route: BitBadgesApiRoutes.GetSearchRoute('dfadfasdfdfaasdfadsf'),
    body: {} as GetSearchBody
  }
];

console.log('Starting benchmarks for', BACKEND_URL);

const status = await axios.post(`${BACKEND_URL}${BitBadgesApiRoutes.GetStatusRoute()}`, {}, config);
const nextCollectionId = status.data.status.nextCollectionId;

const expandedApiBenchmarks: ApiBenchmarkDetails[] = [];
for (const benchmark of apiBenchmarks) {
  if (benchmark.type === 'collection') {
    if (benchmark.options?.tryAllCollections && TRY_ALL_COLLECTIONS) {
      for (let i = 1; i <= Number(nextCollectionId) - 1; i++) {
        expandedApiBenchmarks.push({
          ...benchmark,
          name: `${benchmark.name} - Collection ${i}`,
          body: {
            collectionsToFetch: [
              {
                ...benchmark.body,
                collectionId: `${i}`
              }
            ]
          }
        });
      }
    }
  } else {
    expandedApiBenchmarks.push(benchmark);
  }
}

for (const benchmark of expandedApiBenchmarks) {
  let averageTime = 0;
  let maxTime = 0;

  console.log('----------------------------------');
  for (let i = 0; i < NUM_RUNS_PER_BENCHMARK; i++) {
    const res = await axios.post(`${BACKEND_URL}${benchmark.route}`, benchmark.body, config);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const responseTime = Number(res.headers['x-response-time']);
    if (res.status !== 200) {
      console.log(`Error: ${res.status}`);
      process.exit(1);
    }
    averageTime += responseTime;
    maxTime = Math.max(maxTime, responseTime);
  }

  averageTime /= NUM_RUNS_PER_BENCHMARK;

  console.log(`Benchmark: ${benchmark.name}`);
  console.log(`Average Time: ${averageTime} ms`);
  console.log(`Max Time: ${maxTime} ms`);
  if (benchmark.maxResponseTime && averageTime > benchmark.maxResponseTime) {
    console.log(`WARNING: Average time exceeded max expected time of ${benchmark.maxResponseTime} ms`);
  }
}
