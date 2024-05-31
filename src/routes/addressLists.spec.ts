import {
  BitBadgesApiRoutes,
  BitBadgesUserInfo,
  CompleteClaimPayload,
  GetAccountsPayload,
  GetSearchPayload,
  convertToCosmosAddress,
  type DeleteAddressListsPayload,
  type GetAddressListsPayload,
  type UpdateAddressListsPayload
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { ClaimBuilderModel } from '../db/schemas';

import request from 'supertest';
import { MongoDB, getFromDB, mustGetFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { numUsesPlugin } from '../testutil/plugins';
import { createExampleReqForAddress } from '../testutil/utils';
import { connectToRpc } from '../poll';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

describe('get address lists', () => {
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

  it('should get address lists', async () => {
    const route = BitBadgesApiRoutes.GetAddressListsRoute();
    const body: GetAddressListsPayload = {
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
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const getPayload: GetAddressListsPayload = {
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
      .send(getPayload);
    expect(getRes.status).toBe(200); // it is private

    const getRes2 = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getPayload);

    expect(getRes2.status).toBe(401); // it is private
  });

  it('can create public off-chain lists', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
      .put(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(unAuthRes.status).toBe(401);

    const res = await request(app)
      .put(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetAddressListsRoute();
    const getPayload: GetAddressListsPayload = {
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
      .send(getPayload);

    expect(getRes.status).toBe(200);
    expect(getRes.body.addressLists).toBeDefined();
    expect(getRes.body.addressLists[0].listId).toBe(convertToCosmosAddress(address) + '_testlist123');
  });

  it('should return activity for a list', async () => {
    const route = BitBadgesApiRoutes.GetAddressListsRoute();
    const body: GetAddressListsPayload = {
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
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: DeleteAddressListsPayload = {
      listIds: [convertToCosmosAddress(address) + '_testlist123']
    };

    const unAuthRes = await request(app)
      .delete(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(unAuthRes.status).toBe(401);

    const res = await request(app)
      .delete(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
  });

  it('should not allow anyone to view private lists', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const getPayload: GetAddressListsPayload = {
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
      .send(getPayload);

    expect(getRes.status).toBe(401);

    const getRes2 = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload);
    expect(getRes2.status).toBe(200);
  });

  it('should not allow overwriting lists', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const getPayload: GetAddressListsPayload = {
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
      .send(getPayload);

    expect(getRes.status).toBe(200);
  });

  it('should not show up in search results if private', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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

    const searchRoute = BitBadgesApiRoutes.SearchRoute(convertToCosmosAddress(address) + '_searchable');
    const searchPayload: GetSearchPayload = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchPayload);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(0);
  });

  it('should be searchable if public', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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

    const searchRoute = BitBadgesApiRoutes.SearchRoute(convertToCosmosAddress(address) + '_search123');
    const searchPayload: GetSearchPayload = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchPayload);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(1);
  });

  it('should not show up in search results if viewable with link', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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

    const searchRoute = BitBadgesApiRoutes.SearchRoute(convertToCosmosAddress(address) + '_search1232');
    const searchPayload: GetSearchPayload = {
      noAccounts: true,
      noCollections: true,
      noBadges: true
    };
    const searchRes = await request(app)
      .post(searchRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(searchPayload);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.addressLists.length).toBe(0);
  });

  it('should not show up on user list activity view if private', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const getPayload: GetAccountsPayload = {
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
      .send(getPayload);
    console.log(getRes.body);

    expect(getRes.status).toBe(200);
    expect(getRes.body.accounts).toBeDefined();

    const account = new BitBadgesUserInfo(getRes.body.accounts[0]);
    expect(account.listsActivity).toBeDefined();
    expect(account.listsActivity.find((x) => x.listId === convertToCosmosAddress(address) + '_nonviewable')).toBeUndefined();
  });

  it('should fail on update non-existent list', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
      .put(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(500);
  });

  it('should add activity docs', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
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
    const getPayload: GetAddressListsPayload = {
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
      .send(getPayload);

    expect(getRes.status).toBe(200);
    expect(getRes.body.addressLists).toBeDefined();
    expect(getRes.body.addressLists[0].listId).toBe(convertToCosmosAddress(address) + '_activity');
    expect(getRes.body.addressLists[0].views).toBeDefined();
    expect(getRes.body.addressLists[0].views.listActivity).toBeDefined();
    expect(getRes.body.addressLists[0].views.listActivity.ids.length).toBeGreaterThan(0);
  });

  it('should create an address list w/ private claims', async () => {
    const route = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const body: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_claims',
          private: false,
          viewableWithLink: false,
          addresses: [],
          whitelist: true,
          uri: '',
          customData: '',
          claims: [
            {
              claimId: convertToCosmosAddress(address) + '_claim123',
              plugins: [
                numUsesPlugin(10),
                {
                  pluginId: 'password',
                  instanceId: 'xyz123',
                  publicParams: {},
                  privateParams: {
                    password: 'dfjiaf'
                  },
                  publicState: {},
                  resetState: true
                }
              ]
            }
          ]
        }
      ]
    };
    const numUsesPluginId = body.addressLists[0].claims[0].plugins[0].instanceId;

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    console.log(res.body);
    expect(res.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CompleteClaimRoute(convertToCosmosAddress(address) + '_claim123', convertToCosmosAddress(address));
    const claimPayload: CompleteClaimPayload = {
      xyz123: {
        password: 'dfjiaf'
      }
    };
    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);
    console.log(claimRes.body);

    expect(claimRes.status).toBe(200);

    const claimDoc = await mustGetFromDB(ClaimBuilderModel, convertToCosmosAddress(address) + '_claim123');
    expect(claimDoc).toBeDefined();
    expect(claimDoc.state[`${numUsesPluginId}`].numUses).toBe(1);

    const getRoute = BitBadgesApiRoutes.GetAddressListsRoute();
    const getPayload: GetAddressListsPayload = {
      listsToFetch: [
        {
          listId: convertToCosmosAddress(address) + '_claims',
          viewsToFetch: [],
          fetchPrivateParams: false
        }
      ]
    };
    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload);

    expect(getRes.status).toBe(200);
    expect(getRes.body.addressLists).toBeDefined();
    expect(getRes.body.addressLists[0].claims).toBeDefined();
    expect(getRes.body.addressLists[0].claims.length).toBe(1);
    expect(getRes.body.addressLists[0].claims[0].plugins).toBeDefined();
    expect(getRes.body.addressLists[0].claims[0].plugins.length).toBe(2);
    expect(getRes.body.addressLists[0].claims[0].plugins.find((x: any) => x.pluginId === 'password')).toBeDefined();
    expect(getRes.body.addressLists[0].claims[0].plugins.find((x: any) => x.pluginId === 'password').privateParams?.password).toBeFalsy();

    //Check that the claim action worked
    console.log(getRes.body.addressLists);
    expect(getRes.body.addressLists[0].addresses.length).toBe(1);
    expect(getRes.body.addressLists[0].addresses[0]).toBe(convertToCosmosAddress(address));

    const getRoute2 = BitBadgesApiRoutes.GetAddressListsRoute();
    const getPayload2: GetAddressListsPayload = {
      listsToFetch: [
        {
          listId: convertToCosmosAddress(address) + '_claims',
          viewsToFetch: [],
          fetchPrivateParams: true
        }
      ]
    };

    const getRes2 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload2);

    expect(getRes2.status).toBe(200);
    console.log(getRes2.body.addressLists[0].claims[0].plugins.find((x: any) => x.pluginId === 'password').privateParams?.password);
    expect(getRes2.body.addressLists[0].claims[0].plugins.find((x: any) => x.pluginId === 'password').privateParams?.password).toBe('dfjiaf');

    //Make sure another user cannot fetch private params
    const getRes3 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getPayload2);
    expect(getRes3.status).toBeGreaterThan(400);

    //Different signed in user
    const getRes4 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(getPayload2);
    expect(getRes4.status).toBeGreaterThan(400);

    //Update state correctly
    const updateRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const updatePayload: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_claims',
          private: false,
          viewableWithLink: false,
          addresses: [],
          whitelist: true,
          uri: '',
          customData: '',
          claims: [
            {
              claimId: convertToCosmosAddress(address) + '_claim123',
              plugins: [
                { ...body.addressLists[0].claims[0].plugins[0] },
                {
                  pluginId: 'password',
                  instanceId: 'fadskjh',
                  publicParams: {},
                  privateParams: {
                    password: 'dfjiaf'
                  },
                  publicState: {},
                  resetState: true
                }
              ]
            }
          ]
        }
      ]
    };

    const updateRes = await request(app)
      .put(updateRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updatePayload);
    console.log(updateRes.body);
    expect(updateRes.status).toBe(200);

    const getRes5 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload2);

    expect(getRes5.status).toBe(200);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, convertToCosmosAddress(address) + '_claim123');
    expect(finalDoc).toBeDefined();
    expect(finalDoc.state[`${numUsesPluginId}`].numUses).toBe(1);

    updatePayload.addressLists[0].claims[0].plugins[0].resetState = true;
    const updateRes2 = await request(app)
      .put(updateRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updatePayload);
    expect(updateRes2.status).toBe(200);

    const finalDoc2 = await mustGetFromDB(ClaimBuilderModel, convertToCosmosAddress(address) + '_claim123');
    expect(finalDoc2).toBeDefined();
    expect(finalDoc2.state[`${numUsesPluginId}`].numUses).toBe(0);

    //Check that it deletes old claims
    const updatePayload2: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId: convertToCosmosAddress(address) + '_claims',
          private: false,
          viewableWithLink: false,
          addresses: [],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const updateRes3 = await request(app)
      .put(updateRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updatePayload2);
    expect(updateRes3.status).toBe(200);

    const finalDoc3 = await getFromDB(ClaimBuilderModel, convertToCosmosAddress(address) + '_claim123');
    expect(finalDoc3).toBeDefined();
    expect(finalDoc3?.deletedAt).toBeTruthy();
  }, 100000);
});
