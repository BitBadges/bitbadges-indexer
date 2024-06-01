import {
  BitBadgesApiRoutes,
  CreateClaimPayload,
  CreatePluginPayload,
  GetPluginPayload,
  PluginPresetType,
  UpdateAddressListsPayload,
  UpdateClaimPayload,
  UpdatePluginPayload,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Express } from 'express';
import request from 'supertest';
import { getFromDB, mustGetFromDB } from '../db/db';
import { ClaimBuilderModel, PluginModel } from '../db/schemas';
import { getPluginStateByType, numUsesPlugin } from '../testutil/plugins';
import { createExampleReqForAddress } from '../testutil/utils';
const app = (global as any).app as Express;

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';
const body: CreatePluginPayload = {
  approvedUsers: [],

  toPublish: false,
  pluginId: 'github-contributions',

  requiresUserInputs: false,
  duplicatesAllowed: true,
  reuseForNonIndexed: false,
  reuseForLists: true,

  userInputRedirect: {
    baseUri: 'https://bitbadges.io'
  },

  claimCreatorRedirect: {
    baseUri: 'https://bitbadges.io'
  },

  metadata: {
    name: 'Github Contributions',
    description: "Check a user's Github contributions to a specific repository.",
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/GitHub_Invertocat_Logo.svg/640px-GitHub_Invertocat_Logo.svg.png',
    createdBy: 'BitBadges',
    documentation: 'https://docs.bitbadges.io',
    sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
  },
  verificationCall: {
    method: 'POST',
    uri: 'https://api.bitbadges.io/api/v0/integrations/query/github-contributions'
  },
  stateFunctionPreset: PluginPresetType.Stateless
};

describe('plugins', () => {
  it('should create and update auth apps', async () => {
    const route = BitBadgesApiRoutes.CRUDPluginRoute();
    const pluginId = 'test' + Math.random();
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({
        ...body,
        pluginId
      });
    console.log(res.body);
    expect(res.status).toBe(200);

    const route2 = BitBadgesApiRoutes.CRUDPluginRoute();
    const body2: UpdatePluginPayload = {
      pluginId,
      toPublish: false
    };

    const nonSignedInRes = await request(app)
      .put(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    expect(nonSignedInRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInRes = await request(app)
      .put(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body2);
    expect(altUserSignedInRes.status).toBeGreaterThanOrEqual(400);

    const res2 = await request(app)
      .put(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body2);
    console.log(res2.body);
    expect(res2.status).toBe(200);

    const notSignedInDeleteRes = await request(app)
      .delete(BitBadgesApiRoutes.CRUDPluginRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ pluginId });

    expect(notSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInDeleteRes = await request(app)
      .delete(BitBadgesApiRoutes.CRUDPluginRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send({ pluginId });

    expect(altUserSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const deleteRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const deletePayload = { pluginId };
    const deleteRes = await request(app)
      .delete(deleteRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deletePayload);
    expect(deleteRes.status).toBe(200);

    const finalDoc = await getFromDB(PluginModel, pluginId);
    expect(finalDoc?.deletedAt).toBeTruthy();
  });

  it('should get plugins', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetPluginRoute();
    const getBody: GetPluginPayload = {
      pluginId: createPayload.pluginId
    };

    const notSignedInRes = await request(app)
      .get(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '');

    expect(notSignedInRes.status).toBeGreaterThanOrEqual(400);

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getBody);

    expect(getRes.status).toBe(200);
    expect(getRes.body.plugins.length).toBe(1);
    expect(getRes.body.plugins[0].pluginId).toBe(createPayload.pluginId);
  });

  it('should get directory with blank query', async () => {
    const res = await request(app)
      .post(BitBadgesApiRoutes.GetPluginRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '');

    expect(res.status).toBe(200);
    expect(res.body.plugins.find((x: any) => x.metadata.createdBy === 'BitBadges')).toBeTruthy();

    // none should have plugin secrets
    for (const plugin of res.body.plugins) {
      expect(plugin.pluginSecret).toBeFalsy();
    }
  });

  it('should get all created plugins with the flag', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetPluginRoute();
    const getBody: GetPluginPayload = {
      createdPluginsOnly: true
    };

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getBody);

    expect(getRes.status).toBe(200);
    expect(getRes.body.plugins.length).toBeGreaterThanOrEqual(1);
    expect(getRes.body.plugins[0].pluginSecret).toBeTruthy();
  });

  it('should only be able to create a claim with a non-published plugin if  creator', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId: listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(10), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }]
        }
      ]
    };

    const notSignedInRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);

    expect(notSignedInRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(claimPayload);

    console.log(altUserSignedInRes.body);

    const claimDoc = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc).toBeFalsy();

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();
  });

  it('should work if approved user', async () => {
    const pluginId = 'test' + Math.random();
    const otherAddress = ethers.Wallet.createRandom().address;
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      approvedUsers: [convertToCosmosAddress(otherAddress)]
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(otherAddress) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(otherAddress)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(otherAddress).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(10), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }]
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(otherAddress).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();
  });

  it('should work with custom plugin preset type', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      stateFunctionPreset: PluginPresetType.ClaimNumbers,
      verificationCall: {
        method: 'POST',
        uri: 'random-claim-number' //mocked
      }
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(100), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }],
          assignMethod: 'test'
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();

    const completeClaimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimPayload.claims[0].claimId, convertToCosmosAddress(address));
    const completeClaimRes = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(completeClaimRes.status).toBe(200);

    await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(completeClaimRes.status).toBe(200);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(2);
    expect(getPluginStateByType(finalDoc, 'numUses').claimedUsers[convertToCosmosAddress(address)].length).toBe(2);
    expect(getPluginStateByType(finalDoc, 'numUses').claimedUsers[convertToCosmosAddress(address)][0]).toBeGreaterThan(1);

    //update max uses to be 1
    const updatePayload: UpdateClaimPayload = {
      claims: [
        {
          claimId: claimPayload.claims[0].claimId,
          plugins: [numUsesPlugin(1), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {}, publicState: {} }],
          assignMethod: 'test'
        }
      ]
    };

    await request(app)
      .put(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updatePayload);

    //claim number should be > max so should fail
    const completeClaimRes2 = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});
    expect(completeClaimRes2.status).toBeGreaterThanOrEqual(400);
  });

  it('should not allow duplicate claim numbers to be processes', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      stateFunctionPreset: PluginPresetType.ClaimNumbers,
      verificationCall: {
        method: 'POST',
        uri: 'same-claim-number' //mocked
      }
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(100), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }],
          assignMethod: 'test'
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();

    const completeClaimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimPayload.claims[0].claimId, convertToCosmosAddress(address));
    const completeClaimRes = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(completeClaimRes.status).toBe(200);

    const res2 = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(res2.status).toBeGreaterThanOrEqual(400);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'numUses').claimedUsers[convertToCosmosAddress(address)].length).toBe(1);
  });

  it('should support state transition plugin presets', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      stateFunctionPreset: PluginPresetType.StateTransitions,
      verificationCall: {
        method: 'POST',
        uri: 'random-state-transition' //mocked
      }
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(100), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }]
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();

    const completeClaimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimPayload.claims[0].claimId, convertToCosmosAddress(address));

    let prevState = null;
    for (let i = 0; i <= 20; i++) {
      const completeClaimRes = await request(app)
        .post(completeClaimRoute)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
        .send({});

      expect(completeClaimRes.status).toBe(200);

      let claimDoc = await mustGetFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);

      expect(getPluginStateByType(claimDoc, createPayload.pluginId)).toBeTruthy();
      console.log(getPluginStateByType(claimDoc, createPayload.pluginId));
      expect(JSON.stringify(getPluginStateByType(claimDoc, createPayload.pluginId)) !== JSON.stringify(prevState)).toBeTruthy();

      prevState = getPluginStateByType(claimDoc, createPayload.pluginId);
    }
  }, 30000);

  it('should support the one-time use claim token preset', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      stateFunctionPreset: PluginPresetType.ClaimToken,
      verificationCall: {
        method: 'POST',
        uri: 'claim-tokens-different' //mocked
      }
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(100), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }]
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();

    const completeClaimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimPayload.claims[0].claimId, convertToCosmosAddress(address));

    for (let i = 0; i <= 5; i++) {
      const completeClaimRes = await request(app)
        .post(completeClaimRoute)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
        .send({});

      expect(completeClaimRes.status).toBe(200);
    }
  }, 30000);

  it('should support the one-time use claim token preset - do not allow token reuse', async () => {
    const pluginId = 'test' + Math.random();
    const createRoute = BitBadgesApiRoutes.CRUDPluginRoute();
    const createPayload: CreatePluginPayload = {
      ...body,
      pluginId,
      stateFunctionPreset: PluginPresetType.ClaimToken,
      verificationCall: {
        method: 'POST',
        uri: 'claim-tokens-same' //mocked
      }
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const listId = convertToCosmosAddress(address) + '_testlist123' + Math.random();
    const alRoute = BitBadgesApiRoutes.CRUDAddressListsRoute();
    const alBody: UpdateAddressListsPayload = {
      addressLists: [
        {
          listId,
          private: true,
          addresses: [convertToCosmosAddress(address)],
          whitelist: true,
          uri: '',
          customData: '',
          claims: []
        }
      ]
    };

    const alRes = await request(app)
      .post(alRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(alBody);
    console.log(alRes.body);
    expect(alRes.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CRUDClaimsRoute();
    const claimPayload: CreateClaimPayload = {
      claims: [
        {
          claimId: 'test' + Math.random(),
          listId,
          plugins: [numUsesPlugin(100), { pluginId: createPayload.pluginId, instanceId: 'test', publicParams: {}, privateParams: {} }]
        }
      ]
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(claimPayload);
    expect(claimRes.status).toBe(200);

    const claimDoc2 = await getFromDB(ClaimBuilderModel, claimPayload.claims[0].claimId);
    expect(claimDoc2).toBeTruthy();

    const completeClaimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimPayload.claims[0].claimId, convertToCosmosAddress(address));

    const completeClaimRes = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(completeClaimRes.status).toBe(200);

    const completeClaimRes2 = await request(app)
      .post(completeClaimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({});

    expect(completeClaimRes2.status).toBeGreaterThanOrEqual(400);
  }, 30000);
});
