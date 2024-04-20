import {
  AddBalancesToOffChainStorageRouteRequestBody,
  BigIntify,
  BitBadgesApiRoutes,
  BitBadgesCollection,
  BlockinAndGroup,
  CheckAndCompleteClaimRouteRequestBody,
  ClaimIntegrationPluginType,
  GetCollectionsRouteRequestBody,
  IncrementedBalances,
  IntegrationPluginDetails,
  NumberType,
  UintRangeArray,
  convertOffChainBalancesMap,
  convertToCosmosAddress,
  iAddressList,
  iClaimBuilderDoc
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { AES } from 'crypto-js';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AddressListModel, ClaimBuilderModel, CollectionModel, ExternalCallKeysModel } from '../db/schemas';
import app, { gracefullyShutdown } from '../indexer';
import { generateCodesFromSeed } from '../integrations/codes';
import { getPlugin } from '../integrations/types';
import { connectToRpc } from '../poll';
import {
  apiPlugin,
  codesPlugin,
  discordPlugin,
  mustOwnBadgesPlugin,
  numUsesPlugin,
  passwordPlugin,
  requiresProofOfAddressPlugin,
  transferTimesPlugin,
  twitterPlugin,
  whitelistPlugin
} from '../testutil/plugins';
import { createExampleReqForAddress } from '../testutil/utils';
import { getDecryptedActionCodes } from './claims';
import axios from 'axios';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

const createClaimDoc = async (
  plugins: IntegrationPluginDetails<ClaimIntegrationPluginType>[],
  action?: any
): Promise<iClaimBuilderDoc<NumberType>> => {
  const randomDocId = crypto.randomBytes(32).toString('hex');

  const doc: iClaimBuilderDoc<NumberType> = {
    _docId: randomDocId,
    action: action ?? {
      seedCode: 'U2FsdGVkX1+iqwjCpOvPQCgLkBgVf7nvmHUGSTjxFSZkSSvT7RQV0wlMuVyQXYocdN7ejqk2HF9sij2FpVYpsNqW6asX8dSXZt0BYuBD6SKQyylA75UTBrb45wEpk0F8'
    },
    cid: randomDocId,
    collectionId: 85,
    createdBy: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x',
    docClaimed: true,
    plugins,
    state: plugins.reduce((acc: any, plugin) => {
      acc[plugin.id] = { ...getPlugin(plugin.id).defaultState };
      return acc;
    }, {})
  };

  await insertToDB(ClaimBuilderModel, doc);

  return doc;
};

describe('claims', () => {
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

  it('should create claim in storage', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 2), codesPlugin(10, seedCode)]);

    //c45cecd74e1c8cfd315f400c82a08cf59ef63c2d4bf19e1c74bc0e56eba052be
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };

    const promises = [];

    for (let i = 0; i < 5; i++) {
      promises.push(
        request(app)
          .post(route)
          .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
          .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
          .send(body)
      );
    }

    await Promise.all(promises);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.codes.usedCodeIndices[0]).toBe(1);
  }, 30000);

  it('should not exceed max uses', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(1, 1), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ codes: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should not exceed max uses per address', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 1), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ codes: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);

    const route2 = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(ethers.Wallet.createRandom().address));
    await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ codes: { code: codes[1] } });

    const finalDoc2 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc2.state.numUses.numUses).toBe(2);
  });

  it('should not track with no max uses per address', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ codes: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(2);
  });

  it('should not work with an invalid code', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: 'invalidCode'
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should not exceed max uses with seed code', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    for (const code of codes) {
      const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
      const body: CheckAndCompleteClaimRouteRequestBody = {
        codes: {
          code
        }
      };
      await request(app)
        .post(route)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .send(body);
    }

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(10);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(finalDoc.state.numUses.numUses).toBe(10);
  });

  it('should work with codes (not seedCode)', async () => {
    const codes = ['a', 'b', 'c', 'd', 'e'];
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      {
        id: 'codes',
        publicParams: {
          numCodes: 5
        },
        privateParams: {
          codes: codes.map((code) => AES.encrypt(code, process.env.SYM_KEY ?? '').toString())
        },
        publicState: {
          usedCodeIndices: {}
        }
      }
    ]);

    for (const code of codes) {
      const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
      const body: CheckAndCompleteClaimRouteRequestBody = {
        codes: {
          code
        }
      };
      const res = await request(app)
        .post(route)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .send(body);
      console.log(res.body);
    }

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(5);
  });

  it('should work with valid password', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), passwordPlugin('abc123')]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      password: {
        password: 'abc123'
      }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should not work with invalid password', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), passwordPlugin('abc123')]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      password: {
        password: 'abc1234'
      }
    };

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work within valid transfer times', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), transferTimesPlugin({ start: Date.now(), end: Date.now() + 10000000000000 })]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      transferTimes: {
        time: 50
      }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should not work outside valid transfer times', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      transferTimesPlugin({ start: Date.now() - 10000000000000, end: Date.now() - 10000000000 })
    ]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      transferTimes: {
        time: 50
      }
    };

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work with whitelist', async () => {
    const whitelist: iAddressList = {
      addresses: [convertToCosmosAddress(wallet.address)],
      whitelist: true,
      listId: 'whitelist',
      createdBy: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x',
      uri: '',
      customData: ''
    };

    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, whitelist)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should not work with whitelist', async () => {
    const whitelist: iAddressList = {
      addresses: [convertToCosmosAddress(wallet.address)],
      whitelist: false,
      listId: 'whitelist',
      createdBy: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x',
      uri: '',
      customData: ''
    };

    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, whitelist)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work with listId whitelist', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, undefined, listId)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should work with private lists', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(true, undefined, listId)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should work with private listId whitelist', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(true, undefined, listId)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  // it('should work with greaterThanXBADGEBalance', async () => {
  //   const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(0)]);
  //   const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
  //   const body: CheckAndCompleteClaimRouteRequestBody = {};

  //   const res = await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .send(body);

  //   console.log(res.body);

  //   const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
  //   expect(finalDoc.state.numUses.numUses).toBe(1);
  // });

  // it('should not work with greaterThanXBADGEBalance', async () => {
  //   const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(1000)]);
  //   const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
  //   const body: CheckAndCompleteClaimRouteRequestBody = {};

  //   await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .send(body);

  //   const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
  //   expect(finalDoc.state.numUses.numUses).toBe(0);
  // });

  it('should add to address list action', async () => {
    const existingDoc = await getFromDB(AddressListModel, 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting');
    if (!existingDoc) {
      await insertToDB(AddressListModel, {
        _docId: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting',
        addresses: [],
        whitelist: true,
        listId: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting',
        createdBy: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x',
        uri: '',
        customData: '',
        lastUpdated: Date.now(),
        createdBlock: Date.now(),
        updateHistory: []
      });
    }

    const claimDoc = await createClaimDoc([numUsesPlugin(10, 0)], {
      listId: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting'
    });

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(claimDoc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDoc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);

    const addressList = await mustGetFromDB(AddressListModel, 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting');
    expect(addressList.addresses.includes(convertToCosmosAddress(wallet.address))).toBe(true);
  });

  it('should hand out codes', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0)]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(res.body.code).toBeTruthy();
  });

  it('should handle discord usernames', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      // discord: {
      //   username: 'testuser'
      // }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.discord['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.discord['123456789']).toBe(1);
  });

  it('should handle discord usernames with discriminators', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser#1234'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      // discord: {
      //   username: 'testuser',
      //   discriminator: '1234'
      // }
    };

    const resWithoutDiscriminator = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(wallet.address).session,
          discord: {
            username: 'testuser',
            id: '123456789',
            discriminator: ''
          }
        })
      )
      .send(body);
    console.log(resWithoutDiscriminator.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
    expect(finalDoc.state.discord['123456789']).toBeFalsy();

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(wallet.address).session,
          discord: {
            username: 'testuser',
            id: '123456789',
            discriminator: '1234'
          }
        })
      )
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.discord['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.discord['123456789']).toBe(1);
  });

  it('should fail on invalid discord username not in list', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      // discord: {
      //   username: 'invaliduser'
      // }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(wallet.address).session,
          discord: {
            username: 'invaliduser',
            id: '123456789',
            discriminator: ''
          }
        })
      )
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should handle twitter usernames', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), twitterPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      // twitter: {
      //   username: 'testuser'
      // }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.twitter['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.twitter['123456789']).toBe(1);
  });

  it('should require signature', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), requiresProofOfAddressPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should fail if not signed in (or claiming on behalf of another user)', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), requiresProofOfAddressPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work w/ valid signature', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), requiresProofOfAddressPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should work with mustOwnBadges', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      mustOwnBadgesPlugin(
        new BlockinAndGroup({
          $and: [
            {
              assets: [
                {
                  collectionId: 1n,
                  assetIds: [{ start: 1n, end: 1n }],
                  chain: 'BitBadges',
                  mustOwnAmounts: { start: 1n, end: 1n },
                  ownershipTimes: []
                }
              ]
            }
          ]
        })
      )
    ]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work with mustOwnBadges - own x0', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      mustOwnBadgesPlugin(
        new BlockinAndGroup({
          $and: [
            {
              assets: [
                {
                  collectionId: 1n,
                  assetIds: [{ start: 1n, end: 1n }],
                  chain: 'BitBadges',
                  mustOwnAmounts: { start: 0n, end: 0n },
                  ownershipTimes: []
                }
              ]
            }
          ]
        })
      )
    ]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should work with BitbAdges lists', async () => {
    const lists = await findInDB(AddressListModel, { query: {}, limit: 1 });
    const listId = lists[0]._docId;

    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      mustOwnBadgesPlugin(
        new BlockinAndGroup({
          $and: [
            {
              assets: [
                {
                  collectionId: 'BitBadges Lists',
                  assetIds: [listId],
                  chain: 'BitBadges',
                  mustOwnAmounts: { start: 0n, end: 0n },
                  ownershipTimes: []
                }
              ]
            }
          ]
        })
      )
    ]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
  });

  it('should fail when not on list', async () => {
    const lists = await findInDB(AddressListModel, {
      query: {
        whitelist: true
      },
      limit: 1
    });
    const listId = lists[0]._docId;

    console.log(listId, wallet.address);

    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      mustOwnBadgesPlugin(
        new BlockinAndGroup({
          $and: [
            {
              assets: [
                {
                  collectionId: 'BitBadges Lists',
                  assetIds: [listId],
                  chain: 'BitBadges',
                  mustOwnAmounts: { start: 1n, end: 1n },
                  ownershipTimes: []
                }
              ]
            }
          ]
        })
      )
    ]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(ethers.Wallet.createRandom().address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should not work with an invalid assignMethod', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0, 'invalid' as any)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should work with codesIdx assignMethod', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0, 'codeIdx'), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[1]
      }
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);

    console.log(res.body);

    const actionCodes = getDecryptedActionCodes(finalDoc);
    const returnedCode = res.body.code;

    console.log(returnedCode, actionCodes);
    const idx = actionCodes.indexOf(returnedCode);
    expect(idx).toBe(1);

    const route2 = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body2: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[1]
      }
    };

    const res2 = await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res2.body);

    const finalDoc2 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc2.state.numUses.numUses).toBe(1);

    const route3 = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body3: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };

    const res3 = await request(app)
      .post(route3)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body3);
    console.log(res3.body);

    const finalDoc3 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc3.state.numUses.numUses).toBe(2);

    const newWallet = ethers.Wallet.createRandom();

    const route4 = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(newWallet.address));
    const body4: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: codes[0]
      }
    };

    const res4 = await request(app)
      .post(route4)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body4);
    console.log(res4.body);

    const finalDoc4 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc4.state.numUses.numUses).toBe(2);
  });

  it('should fail on unknown whitelist ID', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, undefined, 'unknown')]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

  it('should handle api calls - returns 0 on failure', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      apiPlugin([
        {
          name: 'Test',
          userInputsSchema: [],
          uri: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'
        }
      ])
    ]);

    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);

    //TODO: This actually fails. Write a better test
    const keyDoc = await getFromDB(ExternalCallKeysModel, 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    expect(keyDoc).toBeTruthy();
    expect(keyDoc?.keys.length).toBeGreaterThan(0);
  });

  it('should work with off-chain balances and claims', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true } })
      .lean()
      .exec();

    console.log([...new Set(collectionDocs.map((x) => x.collectionId))]);
    console.log([...new Set(claimDocs.map((x) => x.collectionId))]);

    let claimDocToUse = undefined;
    let collectionDocToUse = undefined;
    //Find match
    for (const claimDoc of claimDocs) {
      if (collectionDocs.find((x) => x.collectionId === claimDoc.collectionId)) {
        claimDocToUse = claimDoc;
        collectionDocToUse = collectionDocs.find((x) => x.collectionId === claimDoc.collectionId);
        break;
      }
    }

    if (!claimDocToUse || !collectionDocToUse) {
      console.log('No claim docs found');
      throw new Error('No claim docs found');
    }

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: [
        {
          timelineTimes: UintRangeArray.FullRanges(),
          manager: convertToCosmosAddress(wallet.address)
        }
      ]
    });

    const route = BitBadgesApiRoutes.AddBalancesToOffChainStorageRoute();
    const body: AddBalancesToOffChainStorageRouteRequestBody = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new IncrementedBalances({
            startBalances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }],
            incrementBadgeIdsBy: 1n,
            incrementOwnershipTimesBy: 0n
          }),
          plugins: [
            {
              ...numUsesPlugin(10, 0),
              resetState: true
            }
          ]
        },
        {
          claimId: claimDocToUse._docId + 'different id',
          balancesToSet: new IncrementedBalances({
            startBalances: [{ amount: 1n, badgeIds: [{ start: 2n, end: 2n }], ownershipTimes: UintRangeArray.FullRanges() }],
            incrementBadgeIdsBy: 1n,
            incrementOwnershipTimesBy: 0n
          }),
          plugins: [
            {
              ...numUsesPlugin(10, 0),
              resetState: true
            }
          ]
        }
      ],
      balances: {}
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);
    console.log(res.body);
    expect(res.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(claimDocToUse._docId, convertToCosmosAddress(wallet.address));
    const claimBody: CheckAndCompleteClaimRouteRequestBody = {};

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimBody);
    console.log(claimRes.body);
    expect(claimRes.status).toBe(200);

    const claimRes2 = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimBody);
    console.log(claimRes2.body);
    expect(claimRes2.status).toBe(200);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(finalDoc.state.numUses.numUses).toBe(2);

    //sleep for 10s
    await new Promise((r) => setTimeout(r, 10000));

    const balancesUrl = collectionDocToUse.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri;
    const balancesRes = await axios.get(balancesUrl);
    console.log(balancesRes.data);
    const balancesMap = convertOffChainBalancesMap(balancesRes.data, BigIntify);
    console.log(balancesMap[convertToCosmosAddress(wallet.address)]);
    expect(balancesMap[convertToCosmosAddress(wallet.address)]).toBeTruthy();
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].amount).toBe(1n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[0].start).toBe(1n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[0].end).toBe(2n);

    const otherClaimDoc = await mustGetFromDB(ClaimBuilderModel, claimDocToUse._docId + 'different id');
    expect(otherClaimDoc.state.numUses.numUses).toBe(0);

    //Delete the claims

    const resetBody: AddBalancesToOffChainStorageRouteRequestBody = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId + 'different id',
          balancesToSet: new IncrementedBalances({
            startBalances: [{ amount: 1n, badgeIds: [{ start: 2n, end: 2n }], ownershipTimes: UintRangeArray.FullRanges() }],
            incrementBadgeIdsBy: 1n,
            incrementOwnershipTimesBy: 0n
          }),
          plugins: [
            {
              ...numUsesPlugin(10, 0),
              resetState: true
            }
          ]
        }
      ],
      balances: {}
    };

    const resetRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(resetBody);
    console.log(resetRes.body);
    expect(resetRes.status).toBe(200);

    const resetDoc = await getFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(resetDoc).toBeUndefined();
  }, 10000000);

  it('should not reveal private params for off-chain balances', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true } })
      .lean()
      .exec();

    console.log([...new Set(collectionDocs.map((x) => x.collectionId))]);
    console.log([...new Set(claimDocs.map((x) => x.collectionId))]);

    let claimDocToUse = undefined;
    let collectionDocToUse = undefined;
    //Find match
    for (const claimDoc of claimDocs) {
      if (collectionDocs.find((x) => x.collectionId === claimDoc.collectionId)) {
        claimDocToUse = claimDoc;
        collectionDocToUse = collectionDocs.find((x) => x.collectionId === claimDoc.collectionId);
        break;
      }
    }

    if (!claimDocToUse || !collectionDocToUse) {
      console.log('No claim docs found');
      throw new Error('No claim docs found');
    }

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: [
        {
          timelineTimes: UintRangeArray.FullRanges(),
          manager: convertToCosmosAddress(wallet.address)
        }
      ]
    });

    const route = BitBadgesApiRoutes.AddBalancesToOffChainStorageRoute();
    const body: AddBalancesToOffChainStorageRouteRequestBody = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new IncrementedBalances({
            startBalances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }],
            incrementBadgeIdsBy: 1n,
            incrementOwnershipTimesBy: 0n
          }),
          plugins: [
            {
              ...numUsesPlugin(10, 0),
              resetState: true
            },
            {
              ...passwordPlugin('password')
            }
          ]
        }
      ],
      balances: {}
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);

    console.log(res.body);
    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetCollectionsRoute();
    const getBody: GetCollectionsRouteRequestBody = {
      collectionsToFetch: [
        {
          collectionId: collectionDocToUse.collectionId,
          fetchPrivateParams: false
        }
      ]
    };

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getBody);
    console.log(getRes.body);

    const collection = new BitBadgesCollection(getRes.body.collections[0]);
    expect((collection.claims[0].plugins[1].privateParams as any)?.password).toBeUndefined();

    const getRoute2 = BitBadgesApiRoutes.GetCollectionsRoute();
    const getBody2: GetCollectionsRouteRequestBody = {
      collectionsToFetch: [
        {
          collectionId: collectionDocToUse.collectionId,
          fetchPrivateParams: true
        }
      ]
    };

    const getRes2 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(getBody2);

    console.log(getRes2.body);

    const collection2 = new BitBadgesCollection(getRes2.body.collections[0]);
    expect((collection2.claims[0].plugins[1].privateParams as any)?.password).toBeTruthy();

    const getRes3 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(getBody2);
    expect(getRes3.status).toBeGreaterThan(400);
  });
});
