import request from 'supertest';
import app, { gracefullyShutdown } from '../indexer';
import {
  BitBadgesApiRoutes,
  type DeleteAddressListsRouteRequestBody,
  type GetAddressListsRouteRequestBody,
  type UpdateAddressListsRouteRequestBody,
  convertToCosmosAddress,
  GetSearchRouteRequestBody,
  GetAccountsRouteRequestBody,
  BitBadgesUserInfo
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
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    console.log(res.body);
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
    expect(getRes.status).toBe(200); // it is private

    const getRes2 = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getBody);

    expect(getRes2.status).toBe(401); // it is private
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
          claims: []
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

  it('should not allow anyone to view private lists', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123',
          private: true,
          viewableWithLink: false,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
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
      .send(getBody);

    expect(getRes.status).toBe(401);

    const getRes2 = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getBody);
    expect(getRes2.status).toBe(200);
  });

  it('should not allow overwriting lists', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_testlist123456',
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res2.status).toBe(500);
  });

  it('private but viewable with link', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_viewable',
          private: true,
          viewableWithLink: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
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
          listId: convertToCosmosAddress(address) + '_viewable',
          viewsToFetch: []
        }
      ]
    };
    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getBody);

    expect(getRes.status).toBe(200);
  });

  it('should not show up in search results if private', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_searchable',
          private: true,
          viewableWithLink: false,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const searchRoute = BitBadgesApiRoutes.GetSearchRoute(convertToCosmosAddress(address) + '_searchable');
    const searchBody: GetSearchRouteRequestBody = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchBody);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(0);
  });

  it('should be searchable if public', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_search123',
          private: false,
          viewableWithLink: false,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const searchRoute = BitBadgesApiRoutes.GetSearchRoute(convertToCosmosAddress(address) + '_search123');
    const searchBody: GetSearchRouteRequestBody = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchBody);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(1);
  });

  it('should not show up in search results if viewable with link', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_search1232',
          private: true,
          viewableWithLink: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const searchRoute = BitBadgesApiRoutes.GetSearchRoute(convertToCosmosAddress(address) + '_search1232');
    const searchBody: GetSearchRouteRequestBody = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchBody);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(0);
  });

  it('should not show up on user list activity view if private', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_nonviewable',
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetAccountsRoute();
    const getBody: GetAccountsRouteRequestBody = {
      accountsToFetch: [
        {
          address: convertToCosmosAddress(address),
          viewsToFetch: [{ viewType: 'listsActivity', viewId: 'listsActivity', bookmark: '' }]
        }
      ]
    };

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify({}))
      .send(getBody);

    expect(getRes.status).toBe(200);
    expect(getRes.body.accounts).toBeDefined();

    const account = new BitBadgesUserInfo(getRes.body.accounts[0]);
    expect(account.listsActivity).toBeDefined();
    expect(account.listsActivity.find((x) => x.listId === convertToCosmosAddress(address) + '_nonviewable')).toBeUndefined();
  });

  it('should fail on update non-existent list', async () => {
    const route = BitBadgesApiRoutes.UpdateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_nonexistent',
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(500);
  });

  it('should add activity docs', async () => {
    const route = BitBadgesApiRoutes.CreateAddressListRoute();
    const body: UpdateAddressListsRouteRequestBody<bigint> = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_activity',
          private: false,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
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
          listId: convertToCosmosAddress(address) + '_activity',
          viewsToFetch: [{ viewType: 'listActivity', viewId: 'listActivity', bookmark: '' }]
        }
      ]
    };
    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getBody);

    expect(getRes.status).toBe(200);
    expect(getRes.body.addressLists).toBeDefined();
    expect(getRes.body.addressLists[0].listId).toBe(convertToCosmosAddress(address) + '_activity');
    expect(getRes.body.addressLists[0].views).toBeDefined();
    expect(getRes.body.addressLists[0].views.listActivity).toBeDefined();
    expect(getRes.body.addressLists[0].views.listActivity.ids.length).toBeGreaterThan(0);
  });
});
