import request from 'supertest';
import app, { gracefullyShutdown } from '../indexer';
import {
  BitBadgesApiRoutes,
  type DeleteAddressListsRouteRequestBody,
  type GetAddressListsRouteRequestBody,
  type UpdateAddressListsRouteRequestBody,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { MongoDB } from '../db/db';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

describe('get address lists', () => {
  beforeAll(() => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}
  });

  afterAll(async () => {
    await gracefullyShutdown();
  });

  it('should get address lists', async () => {
    const route = BitBadgesApiRoutes.GetAddressListsRoute();
    const body: GetAddressListsRouteRequestBody = {
      listsToFetch: [
        {
          listId: 'All',
          viewsToFetch: []
        }
      ]
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.addressLists).toBeDefined();
    expect(res.body.addressLists[0].listId).toBe('All');
  });

  it('can create off-chain lists', async () => {
    const route = BitBadgesApiRoutes.UpdateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          editClaims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetAddressListsRoute();
    const getBody: GetAddressListsRouteRequestBody = {
      listsToFetch: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          viewsToFetch: []
        }
      ]
    };
    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getBody);

    expect(getRes.status).toBe(401); // since it is private
  });

  it('can create public off-chain lists', async () => {
    const route = BitBadgesApiRoutes.UpdateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          private: false,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          editClaims: []
        }
      ]
    };

    const unAuthRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(unAuthRes.status).toBe(401);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetAddressListsRoute();
    const getBody: GetAddressListsRouteRequestBody = {
      listsToFetch: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          viewsToFetch: []
        }
      ]
    };
    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getBody);

    expect(getRes.status).toBe(200);
    expect(getRes.body.addressLists).toBeDefined();
    expect(getRes.body.addressLists[0].listId).toBe(convertToCosmosAddress(address) + '_testlist123');
  });

  it('should return activity for a list', async () => {
    const route = BitBadgesApiRoutes.GetAddressListsRoute();
    const body: GetAddressListsRouteRequestBody = {
      listsToFetch: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          viewsToFetch: [{ viewType: 'listActivity', viewId: 'listActivity', bookmark: '' }]
        }
      ]
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.addressLists).toBeDefined();
    expect(res.body.addressLists[0].listId).toBe(convertToCosmosAddress(address) + '_testlist123');
    expect(res.body.addressLists[0].views).toBeDefined();
    expect(res.body.addressLists[0].views.listActivity).toBeDefined();
    expect(res.body.addressLists[0].views.listActivity.ids.length).toBeGreaterThan(0);
  });

  it('should delete lists', async () => {
    const route = BitBadgesApiRoutes.DeleteAddressListRoute();
    const body: DeleteAddressListsRouteRequestBody = {
      listIds: [convertToCosmosAddress(address) + '_testlist123']
    };

    const unAuthRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(unAuthRes.status).toBe(401);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
  });
});
