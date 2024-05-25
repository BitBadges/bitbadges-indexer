import { BitBadgesApiRoutes, BitBadgesCollection, GetCollectionsPayload, convertToCosmosAddress } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { connectToRpc } from '../poll';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

describe('collections', () => {
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
    await gracefullyShutdown();
  });

  it('should get collection', async () => {
    const route = BitBadgesApiRoutes.GetCollectionsRoute();
    const body: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 1
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
  });

  it('should get badge metadata - badgeIds', async () => {
    const route = BitBadgesApiRoutes.GetCollectionsRoute();
    const body: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 1,
          metadataToFetch: {
            badgeIds: [{ start: 1n, end: 10n }]
          }
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    const collection = new BitBadgesCollection(res.body.collections[0]);
    expect(collection.getCurrentBadgeMetadata().length).toBeGreaterThan(0);

    expect(collection.getBadgeMetadata(1n)).toBeDefined();
    expect(collection.getBadgeMetadata(10n)).toBeDefined();

    expect(collection.getBadgeBalanceInfo('Mint')).toBeUndefined();
  });

  // it('should get metadata from metadata IDs', async () => {
  //   const route = BitBadgesApiRoutes.GetCollectionsRoute();
  //   const body: GetCollectionsPayload = {
  //     collectionsToFetch: [
  //       {
  //         collectionId: 1,
  //         metadataToFetch: {
  //           metadataIds: [{ start: 1n, end: 10n }]
  //         }
  //       }
  //     ]
  //   };

  //   const res = await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
  //     .send(body);

  //   expect(res.status).toBe(200);

  //   const collection = new BitBadgesCollection(res.body.collections[0]);
  //   expect(collection.getCurrentBadgeMetadata()).toBeGreaterThan(0);
  //   // expect(collection.getBadgeMetadata(1n)).toBeDefined(); Bootstrapped order is way out of order
  //   expect(collection.getBadgeMetadata(2)).toBeDefined();
  // });

  it('should get total and mint balances', async () => {
    const route = BitBadgesApiRoutes.GetCollectionsRoute();
    const body: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 1,
          fetchTotalAndMintBalances: true
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const collection = new BitBadgesCollection(res.body.collections[0]);
    expect(collection.getBadgeBalanceInfo('Mint')).toBeDefined();
    expect(collection.getBadgeBalanceInfo('Total')).toBeDefined();
  });

  it('should get views', async () => {
    const route = BitBadgesApiRoutes.GetCollectionsRoute();
    const body: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 8,
          viewsToFetch: [
            {
              viewType: 'transferActivity',
              viewId: 'transferActivity',
              bookmark: ''
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const collection = new BitBadgesCollection(res.body.collections[0]);
    expect(collection.getActivityView('transferActivity')).toBeDefined();
    expect(collection.getActivityView('transferActivity')?.length).toBeGreaterThan(0);

    const bookmark = res.body.collections[0].views.transferActivity.pagination.bookmark;
    const body2: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 8,
          viewsToFetch: [
            {
              viewType: 'transferActivity',
              viewId: 'transferActivity',
              bookmark
            }
          ]
        }
      ]
    };

    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body2);

    expect(res2.status).toBe(200);
    expect(res2.body.collections[0].views.transferActivity.pagination.bookmark).not.toBe(bookmark);

    const collection2 = new BitBadgesCollection(res2.body.collections[0]);
    expect(collection2.getActivityView('transferActivity')).toBeDefined();
    expect(collection2.getActivityView('transferActivity')?.length).toBeGreaterThan(0);
  });

  it('should get owners view', async () => {
    const route = BitBadgesApiRoutes.GetCollectionsRoute();
    const body: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 8,
          viewsToFetch: [
            {
              viewType: 'owners',
              viewId: 'owners',
              bookmark: ''
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const collection = new BitBadgesCollection(res.body.collections[0]);
    expect(collection.getActivityView('owners')).toBeDefined();
    expect(collection.getActivityView('owners')?.length).toBeGreaterThan(0);

    const bookmark = res.body.collections[0].views.owners.pagination.bookmark;
    const body2: GetCollectionsPayload = {
      collectionsToFetch: [
        {
          collectionId: 8,
          viewsToFetch: [
            {
              viewType: 'owners',
              viewId: 'owners',
              bookmark
            }
          ]
        }
      ]
    };

    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body2);

    expect(res2.status).toBe(200);
    expect(res2.body.collections[0].views.owners.pagination.bookmark).not.toBe(bookmark);

    const collection2 = new BitBadgesCollection(res2.body.collections[0]);
    expect(collection2.getActivityView('owners')).toBeDefined();
    expect(collection2.getActivityView('owners')?.length).toBeGreaterThan(0);
  });

  it('should get specific badge owners', async () => {
    const route = BitBadgesApiRoutes.GetOwnersForBadgeRoute(8, 1);
    const body = {
      bookmark: ''
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.owners.length).toBeGreaterThan(0);
  });

  it('should get specific badge activity', async () => {
    const route = BitBadgesApiRoutes.GetBadgeActivityRoute(8, 1);
    const body = {
      bookmark: ''
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.activity.length).toBeGreaterThan(0);
  });

  it('should get specific badge balance', async () => {
    const route = BitBadgesApiRoutes.GetBadgeBalanceByAddressRoute(8, convertToCosmosAddress(address));
    const body = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
  });

  it('should get first eth tx balance', async () => {
    const route = BitBadgesApiRoutes.GetBadgeBalanceByAddressRoute(16, '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'); //vitalik
    const body = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.balances).toBeDefined();
    expect(res.body.balances.length).toBeGreaterThan(0);
    expect(Number(res.body.balances[0].amount)).toBe(1);
  });
});
