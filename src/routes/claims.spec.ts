import axios from 'axios';
import {
  AddApprovalDetailsToOffChainStoragePayload,
  AddBalancesToOffChainStoragePayload,
  BigIntify,
  BitBadgesApiRoutes,
  BitBadgesCollection,
  BlockinAndGroup,
  ClaimIntegrationPluginType,
  ClaimIntegrationPrivateStateType,
  CollectionApproval,
  CompleteClaimPayload,
  GetCollectionsPayload,
  IncrementedBalances,
  IntegrationPluginDetails,
  MsgUniversalUpdateCollection,
  MsgUpdateUserApprovals,
  NumberType,
  Numberify,
  PredeterminedBalances,
  UintRangeArray,
  UserOutgoingApproval,
  convertOffChainBalancesMap,
  convertToCosmosAddress,
  iAddressList,
  iClaimBuilderDoc
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { AES, SHA256 } from 'crypto-js';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AddressListModel, ClaimBuilderModel, CollectionModel } from '../db/schemas';
import app, { gracefullyShutdown } from '../indexer';
import { generateCodesFromSeed } from '../integrations/codes';
import { connectToRpc } from '../poll';
import { signAndBroadcast } from '../testutil/broadcastUtils';
import {
  apiPlugin,
  codesPlugin,
  discordPlugin,
  getPluginIdByType,
  getPluginStateByType,
  initiatedByPlugin,
  mustOwnBadgesPlugin,
  numUsesPlugin,
  passwordPlugin,
  transferTimesPlugin,
  twitterPlugin,
  whitelistPlugin
} from '../testutil/plugins';
import { createExampleReqForAddress } from '../testutil/utils';
import { findInDB } from '../db/queries';
import { getPlugin } from '../integrations/types';
import { getDecryptedActionCodes } from './claims';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

const sampleMsgCreateCollection = require('../setup/bootstrapped-collections/19_zkp.json');

const createClaimDoc = async (
  plugins: IntegrationPluginDetails<ClaimIntegrationPluginType>[],
  action?: any
): Promise<iClaimBuilderDoc<NumberType>> => {
  const randomDocId = crypto.randomBytes(32).toString('hex');

  const state: any = {};
  for (const plugin of plugins) {
    const pluginObj = await getPlugin(plugin.type);
    state[plugin.id] = { ...pluginObj.defaultState };
  }

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
    state: state,
    lastUpdated: Date.now()
  };

  await insertToDB(ClaimBuilderModel, doc);

  return doc;
};

describe('claims', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'false';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}

    await connectToRpc();
  });

  afterAll(async () => {
    await gracefullyShutdown();
  }, 5000);

  it('should create claim in storage', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 2), codesPlugin(10, seedCode)]);

    //c45cecd74e1c8cfd315f400c82a08cf59ef63c2d4bf19e1c74bc0e56eba052be
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
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
    console.log(JSON.stringify(finalDoc, null, 2));
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'codes').usedCodeIndices[0]).toBe(1);
  }, 30000);

  it('should not exceed max uses', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(1, 1), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
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
      .send({ [`${getPluginIdByType(doc, 'codes')}`]: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should not exceed max uses per address', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 1), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
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
      .send({ [`${getPluginIdByType(doc, 'codes')}`]: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);

    const route2 = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(ethers.Wallet.createRandom().address));
    await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ [`${getPluginIdByType(doc, 'codes')}`]: { code: codes[1] } });

    const finalDoc2 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc2, 'numUses').numUses).toBe(2);
  });

  it('should not track with no max uses per address', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
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
      .send({ [`${getPluginIdByType(doc, 'codes')}`]: { code: codes[1] } });

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(2);
  });

  it('should not work with an invalid code', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: 'invalidCode'
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should not exceed max uses with seed code', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), codesPlugin(10, seedCode)]);

    for (const code of codes) {
      const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
      const body: CompleteClaimPayload = {
        [`${getPluginIdByType(doc, 'codes')}`]: {
          code
        }
      };
      await request(app)
        .post(route)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .send(body);
    }

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(10);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: codes[0]
      }
    };
    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(10);
  });

  it('should work with codes (not seedCode)', async () => {
    const codes = ['a', 'b', 'c', 'd', 'e'];
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      {
        type: 'codes',
        id: 'dsfhsfd',
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
      const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
      const body: CompleteClaimPayload = {
        [`${getPluginIdByType(doc, 'codes')}`]: {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(5);
  });

  it('should work with valid password', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), passwordPlugin('abc123')]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'password')}`]: {
        password: 'abc123'
      }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should not work with invalid password', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), passwordPlugin('abc123')]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'password')}`]: {
        password: 'abc1234'
      }
    };

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should work within valid transfer times', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), transferTimesPlugin({ start: Date.now(), end: Date.now() + 10000000000000 })]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should not work outside valid transfer times', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      transferTimesPlugin({ start: Date.now() - 10000000000000, end: Date.now() - 10000000000 })
    ]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      transferTimes: {
        time: 50
      }
    };

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
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
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
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
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should work with listId whitelist', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, undefined, listId)]);
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should work with private lists', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(true, undefined, listId)]);
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should work with private listId whitelist', async () => {
    const listId = convertToCosmosAddress(wallet.address);
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(true, undefined, listId)]);
    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  // it('should work with greaterThanXBADGEBalance', async () => {
  //   const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(0)]);
  //   const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
  //   const body: CompleteClaimPayload = {};

  //   const res = await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .send(body);

  //   console.log(res.body);

  //   const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
  //   expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  // });

  // it('should not work with greaterThanXBADGEBalance', async () => {
  //   const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(1000)]);
  //   const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
  //   const body: CompleteClaimPayload = {};

  //   await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .send(body);

  //   const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
  //   expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
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

    const route = BitBadgesApiRoutes.CompleteClaimRoute(claimDoc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDoc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);

    const addressList = await mustGetFromDB(AddressListModel, 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x_listfortesting');
    expect(addressList.addresses.includes(convertToCosmosAddress(wallet.address))).toBe(true);
  });

  it('should hand out codes', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0)]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(res.body.code).toBeTruthy();
  });

  it('should handle discord usernames', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBe(1);
  });

  it('should handle discord usernames with discriminators', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser#1234'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBeFalsy();

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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBe(1);
  });

  it('should fail on invalid discord username not in list', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), discordPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should handle twitter usernames', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), twitterPlugin(['testuser'])]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
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
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'twitter').ids['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'twitter').ids['123456789']).toBe(1);
  });

  it('should require signature', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), initiatedByPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should fail if not signed in (or claiming on behalf of another user)', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), initiatedByPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should work w/ valid signature', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), initiatedByPlugin()]);
    console.log(doc.action);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(body);
    console.log(res.body);

    //Cant just be a random request from any generic user (the wallet.address user in this case)
    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
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

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
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

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
  });

  it('should work with BitbAdges lists', async () => {
    const lists = await findInDB(AddressListModel, { query: { whitelist: true }, limit: 1 });
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

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(ethers.Wallet.createRandom().address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    const listDoc = await mustGetFromDB(AddressListModel, listId);
    console.log(listDoc);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
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

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(ethers.Wallet.createRandom().address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should not work with an invalid assignMethod', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0, 'invalid' as any)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should work with codesIdx assignMethod', async () => {
    const seedCode = crypto.randomBytes(32).toString('hex');
    const codes = generateCodesFromSeed(seedCode, 10);
    const doc = await createClaimDoc([numUsesPlugin(10, 0, 'codeIdx'), codesPlugin(10, seedCode)]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: codes[1]
      }
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);

    const actionCodes = getDecryptedActionCodes(finalDoc);
    const returnedCode = res.body.code;

    const idx = actionCodes.indexOf(returnedCode);
    expect(idx).toBe(1);

    const route2 = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body2: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: codes[1]
      }
    };

    const res2 = await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res2.body);

    const finalDoc2 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc2, 'numUses').numUses).toBe(1);

    const route3 = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body3: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: codes[0]
      }
    };

    const res3 = await request(app)
      .post(route3)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body3);
    console.log(res3.body);

    const finalDoc3 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc3, 'numUses').numUses).toBe(2);

    const newWallet = ethers.Wallet.createRandom();

    const route4 = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(newWallet.address));
    const body4: CompleteClaimPayload = {
      [`${getPluginIdByType(doc, 'codes')}`]: {
        code: codes[0]
      }
    };

    const res4 = await request(app)
      .post(route4)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body4);
    console.log(res4.body);

    const finalDoc4 = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc4, 'numUses').numUses).toBe(2);
  });

  it('should fail on unknown whitelist ID', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), whitelistPlugin(false, undefined, 'unknown')]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);
  });

  it('should handle api calls - returns 0 on failure', async () => {
    const doc = await createClaimDoc([
      numUsesPlugin(10, 0),
      apiPlugin(
        // [
        //   {
        //     type: 'custom',
        //     id: 'fdhgasdgfhkj',
        //     method: 'GET',
        //     name: 'Test',
        //     userInputsSchema: [],
        //     uri: 'https://jkdsahfjkasdfjhlkasdfjhslkdaf.com/nonexistent'
        //   }
        // ],
        'discord-server',
        {},
        {}
      )
    ]);

    const route = BitBadgesApiRoutes.CompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CompleteClaimPayload = {};

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(0);

    // const keyDoc = await getFromDB(ExternalCallKeysModel, 'https://jkdsahfjkasdfjhlkasdfjhslkdaf.com/nonexistent');
    // expect(keyDoc).toBeTruthy();
    // expect(keyDoc?.keys.length).toBeGreaterThan(0);
  });

  it('should work with off-chain balances and claims', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true }, deletedAt: { $exists: false } })
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
      console.log(collectionDocToUse, claimDocToUse);
      console.log('No claim docs found');
      throw new Error('No claim docs found');
    }

    console.log(claimDocToUse);

    const currManagerTimeline = collectionDocToUse.managerTimeline;

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
    const body: AddBalancesToOffChainStoragePayload = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new PredeterminedBalances({
            incrementedBalances: new IncrementedBalances({
              startBalances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }],
              incrementBadgeIdsBy: 1n,
              incrementOwnershipTimesBy: 0n
            }),
            manualBalances: [],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            }
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
          balancesToSet: new PredeterminedBalances({
            manualBalances: [],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            },
            incrementedBalances: new IncrementedBalances({
              startBalances: [{ amount: 1n, badgeIds: [{ start: 2n, end: 2n }], ownershipTimes: UintRangeArray.FullRanges() }],
              incrementBadgeIdsBy: 1n,
              incrementOwnershipTimesBy: 0n
            })
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

    const claimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimDocToUse._docId, convertToCosmosAddress(wallet.address));
    const claimPayload: CompleteClaimPayload = {};

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);
    console.log(claimRes.body);
    expect(claimRes.status).toBe(200);

    const claimRes2 = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);
    console.log(claimRes2.body);
    expect(claimRes2.status).toBe(200);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(2);

    //sleep for 10s
    await new Promise((r) => setTimeout(r, 4000));

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
    expect(getPluginStateByType(otherClaimDoc, 'numUses').numUses).toBe(0);

    //Delete the claims

    const resetPayload: AddBalancesToOffChainStoragePayload = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId + 'different id',
          balancesToSet: new PredeterminedBalances({
            manualBalances: [],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            },
            incrementedBalances: new IncrementedBalances({
              startBalances: [{ amount: 1n, badgeIds: [{ start: 2n, end: 2n }], ownershipTimes: UintRangeArray.FullRanges() }],
              incrementBadgeIdsBy: 1n,
              incrementOwnershipTimesBy: 0n
            })
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
      .send(resetPayload);
    console.log(resetRes.body);
    expect(resetRes.status).toBe(200);

    const resetDoc = await getFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(resetDoc).toBeDefined();
    expect(resetDoc?.deletedAt).toBeTruthy();

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: currManagerTimeline //Avoid side effects
    });
  }, 10000000);

  it('should work with off-chain manual balances and claims', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true }, deletedAt: { $exists: false } })
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

    console.log(claimDocToUse);

    const currManagerTimeline = collectionDocToUse.managerTimeline;

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
    const body: AddBalancesToOffChainStoragePayload = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new PredeterminedBalances({
            incrementedBalances: new IncrementedBalances({
              startBalances: [],
              incrementBadgeIdsBy: 0n,
              incrementOwnershipTimesBy: 0n
            }),
            manualBalances: [
              { balances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }] },
              { balances: [{ amount: 1n, badgeIds: [{ start: 100n, end: 100n }], ownershipTimes: UintRangeArray.FullRanges() }] }
            ],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            }
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
    expect(res.status).toBe(200);

    const claimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimDocToUse._docId, convertToCosmosAddress(wallet.address));
    const claimPayload: CompleteClaimPayload = {};

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);
    console.log(claimRes.body);
    expect(claimRes.status).toBe(200);

    const claimRes2 = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(claimPayload);
    console.log(claimRes2.body);
    expect(claimRes2.status).toBe(200);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(2);

    //sleep for 10s
    await new Promise((r) => setTimeout(r, 4000));

    const balancesUrl = collectionDocToUse.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri;
    const balancesRes = await axios.get(balancesUrl);
    console.log(balancesRes.data);
    const balancesMap = convertOffChainBalancesMap(balancesRes.data, BigIntify);
    console.log(balancesMap[convertToCosmosAddress(wallet.address)]);
    expect(balancesMap[convertToCosmosAddress(wallet.address)]).toBeTruthy();
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].amount).toBe(1n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[0].start).toBe(1n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[0].end).toBe(1n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[1].start).toBe(100n);
    expect(balancesMap[convertToCosmosAddress(wallet.address)][0].badgeIds[1].end).toBe(100n);

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: currManagerTimeline //Avoid side effects
    });
  }, 10000000);

  it('should get private state correctly', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true }, deletedAt: { $exists: false } })
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

    const currManagerTimeline = collectionDocToUse.managerTimeline;

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
    const body: AddBalancesToOffChainStoragePayload = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new PredeterminedBalances({
            incrementedBalances: new IncrementedBalances({
              startBalances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }],
              incrementBadgeIdsBy: 1n,
              incrementOwnershipTimesBy: 0n
            }),
            manualBalances: [],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            }
          }),
          plugins: [
            {
              ...numUsesPlugin(10, 0),
              resetState: true
            },
            {
              ...discordPlugin([])
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

    const claimRoute = BitBadgesApiRoutes.CompleteClaimRoute(claimDocToUse._docId, convertToCosmosAddress(wallet.address));
    const claimPayload: CompleteClaimPayload = {
      // discord: {
      //   username: 'testuser'
      // }
    };

    const claimRes = await request(app)
      .post(claimRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .send(claimPayload);
    console.log(claimRes.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, claimDocToUse._docId);
    expect(getPluginStateByType(finalDoc, 'numUses').numUses).toBe(1);
    expect(getPluginStateByType(finalDoc, 'discord').ids['123456789']).toBe(1);

    const getRoute = BitBadgesApiRoutes.GetCollectionsRoute();
    const getPayload: GetCollectionsPayload = {
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
      .send(getPayload);
    console.log(getRes.body);

    const collection = new BitBadgesCollection(getRes.body.collections[0]);
    expect((collection.claims[0].plugins[1].privateParams as any)?.password).toBeUndefined();
    expect(collection.claims[0].plugins[1].privateState as any).toBeFalsy();

    const getRoute2 = BitBadgesApiRoutes.GetCollectionsRoute();
    const getPayload2: GetCollectionsPayload = {
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
      .send(getPayload2);

    console.log(getRes2.body);

    const collection2 = new BitBadgesCollection(getRes2.body.collections[0]);
    expect((collection2.claims[0].plugins[1].privateState as ClaimIntegrationPrivateStateType<'discord'>)?.ids['123456789']).toBe(1);
    expect((collection2.claims[0].plugins[1].privateState as ClaimIntegrationPrivateStateType<'discord'>)?.usernames['testuser']).toBe('123456789');

    const getRes3 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(getPayload2);
    expect(getRes3.status).toBeGreaterThan(400);

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: currManagerTimeline //Avoid side effects
    });
  });

  it('should not reveal private params for off-chain balances', async () => {
    const collectionDocs = await CollectionModel.find({ balancesType: 'Off-Chain - Indexed' }).lean().exec();
    const claimDocs = await ClaimBuilderModel.find({ 'action.balancesToSet': { $exists: true }, deletedAt: { $exists: false } })
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

    const currManagerTimeline = collectionDocToUse.managerTimeline;

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
    const body: AddBalancesToOffChainStoragePayload = {
      collectionId: collectionDocToUse.collectionId,
      method: 'centralized',
      claims: [
        {
          claimId: claimDocToUse._docId,
          balancesToSet: new PredeterminedBalances({
            incrementedBalances: new IncrementedBalances({
              startBalances: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: UintRangeArray.FullRanges() }],
              incrementBadgeIdsBy: 1n,
              incrementOwnershipTimesBy: 0n
            }),
            manualBalances: [],
            orderCalculationMethod: {
              useOverallNumTransfers: true,
              useMerkleChallengeLeafIndex: false,
              usePerFromAddressNumTransfers: false,
              usePerInitiatedByAddressNumTransfers: false,
              usePerToAddressNumTransfers: false,
              challengeTrackerId: ''
            }
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
    const getPayload: GetCollectionsPayload = {
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
      .send(getPayload);
    console.log(getRes.body);

    const collection = new BitBadgesCollection(getRes.body.collections[0]);
    expect((collection.claims[0].plugins[1].privateParams as any)?.password).toBeUndefined();
    expect(collection.claims[0].plugins[1].privateState as any).toBeFalsy();

    const getRoute2 = BitBadgesApiRoutes.GetCollectionsRoute();
    const getPayload2: GetCollectionsPayload = {
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
      .send(getPayload2);

    console.log(getRes2.body);

    const collection2 = new BitBadgesCollection(getRes2.body.collections[0]);
    expect((collection2.claims[0].plugins[1].privateParams as any)?.password).toBeTruthy();

    const getRes3 = await request(app)
      .post(getRoute2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(getPayload2);
    expect(getRes3.status).toBeGreaterThan(400);

    await insertToDB(CollectionModel, {
      ...collectionDocToUse,
      managerTimeline: currManagerTimeline //Avoid side effects
    });
  });

  it('should create on-chain claims correctly and claim it', async () => {
    const wallet = ethers.Wallet.createRandom();
    const seedCode = crypto.randomBytes(32).toString('hex');
    const route = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: crypto.randomBytes(32).toString('hex'),
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0),
                    resetState: true
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex'))
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);
    expect(res.status).toBe(200);

    const msg = new MsgUniversalUpdateCollection<NumberType>({
      ...sampleMsgCreateCollection,
      creator: convertToCosmosAddress(wallet.address),
      managerTimeline: [
        {
          timelineTimes: UintRangeArray.FullRanges(),
          manager: convertToCosmosAddress(wallet.address)
        }
      ],
      collectionApprovals: [
        new CollectionApproval({
          fromListId: 'Mint',
          toListId: 'All',
          initiatedByListId: 'All',
          transferTimes: UintRangeArray.FullRanges(),
          badgeIds: UintRangeArray.FullRanges(),
          ownershipTimes: UintRangeArray.FullRanges(),
          approvalId: crypto.randomBytes(32).toString('hex'),
          approvalCriteria: {
            merkleChallenges: [
              {
                //Don't care about core details now
                root: 'fhjadsfkja',
                expectedProofLength: 2n,
                uri: '',
                customData: '',
                useCreatorAddressAsLeaf: false,
                maxUsesPerLeaf: 1n,

                //We do care about these
                challengeTrackerId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? ''
              }
            ]
          }
        })
      ],
      collectionPermissions: {
        ...sampleMsgCreateCollection.collectionPermissions,
        canUpdateCollectionApprovals: [
          {
            fromListId: 'All',
            toListId: 'All',
            initiatedByListId: 'All',
            approvalId: 'All',
            ownershipTimes: UintRangeArray.FullRanges(),
            badgeIds: UintRangeArray.FullRanges(),
            transferTimes: UintRangeArray.FullRanges(),

            permanentlyForbiddenTimes: UintRangeArray.FullRanges(),
            permanentlyPermittedTimes: []
          }
        ]
      }
    })
      .convert(BigIntify)
      .toProto();

    const txRes = await signAndBroadcast([msg], wallet);
    console.log(txRes);

    //Sleep 10 seconds to allow it to claim
    await new Promise((r) => setTimeout(r, 4000));

    const claimDoc = await mustGetFromDB(ClaimBuilderModel, body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');
    expect(Number(claimDoc.collectionId)).toBeGreaterThan(0);
    expect(claimDoc.docClaimed).toBeTruthy();
    expect(claimDoc.trackerDetails).toBeTruthy();
    expect(claimDoc.trackerDetails?.challengeTrackerId).toBe(body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');

    //Try and update it (even though on-chain permissions disallow it)
    const route2 = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body2: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '',
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0)
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex')),

                    resetState: true
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res2 = await request(app)
      .post(route2)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res2.body);
    expect(res2.status).toBeGreaterThan(400);
  }, 100000);

  it('should allow updates if on-chain permissions allow', async () => {
    const wallet = ethers.Wallet.createRandom();
    const seedCode = crypto.randomBytes(32).toString('hex');
    const route = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: crypto.randomBytes(32).toString('hex'),
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0),
                    resetState: true
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex'))
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);
    expect(res.status).toBe(200);

    const msg = new MsgUniversalUpdateCollection<NumberType>({
      ...sampleMsgCreateCollection,
      creator: convertToCosmosAddress(wallet.address),
      managerTimeline: [
        {
          timelineTimes: UintRangeArray.FullRanges(),
          manager: convertToCosmosAddress(wallet.address)
        }
      ],
      collectionApprovals: [
        new CollectionApproval({
          fromListId: 'Mint',
          toListId: 'All',
          initiatedByListId: 'All',
          transferTimes: UintRangeArray.FullRanges(),
          badgeIds: UintRangeArray.FullRanges(),
          ownershipTimes: UintRangeArray.FullRanges(),
          approvalId: crypto.randomBytes(32).toString('hex'),
          approvalCriteria: {
            merkleChallenges: [
              {
                //Don't care about core details now
                root: 'fhjadsfkja',
                expectedProofLength: 2n,
                uri: '',
                customData: '',
                useCreatorAddressAsLeaf: false,
                maxUsesPerLeaf: 1n,

                //We do care about these
                challengeTrackerId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? ''
              }
            ]
          }
        })
      ],
      collectionPermissions: {
        ...sampleMsgCreateCollection.collectionPermissions,
        canUpdateCollectionApprovals: [] //none meaning neutral and allowed
      }
    })
      .convert(BigIntify)
      .toProto();

    const txRes = await signAndBroadcast([msg], wallet);
    console.log(txRes);

    //Sleep 10 seconds to allow it to claim
    await new Promise((r) => setTimeout(r, 4000));

    const claimDoc = await mustGetFromDB(ClaimBuilderModel, body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');
    expect(Number(claimDoc.collectionId)).toBeGreaterThan(0);
    expect(claimDoc.docClaimed).toBeTruthy();
    expect(claimDoc.trackerDetails).toBeTruthy();
    expect(claimDoc.trackerDetails?.challengeTrackerId).toBe(body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');

    //Try and update it (even though on-chain permissions disallow it)
    const route2 = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body2: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '',
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0)
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex')),

                    resetState: true
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res2 = await request(app)
      .post(route2)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res2.body);
    expect(res2.status).toBe(200);

    //Non-manager attempts to update it
    const res3 = await request(app)
      .post(route2)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res3.body);
    expect(res3.status).toBeGreaterThan(400);
  }, 100000);

  it('should create outgoing claims correctly', async () => {
    const wallet = ethers.Wallet.createRandom();
    const managerWallet = ethers.Wallet.createRandom();
    const seedCode = crypto.randomBytes(32).toString('hex');
    const route = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: crypto.randomBytes(32).toString('hex'),
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0),
                    resetState: true
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex'))
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    console.log(res.body);
    expect(res.status).toBe(200);

    const msg = new MsgUniversalUpdateCollection<NumberType>({
      ...sampleMsgCreateCollection,
      creator: convertToCosmosAddress(managerWallet.address),
      managerTimeline: [
        {
          timelineTimes: UintRangeArray.FullRanges(),
          manager: convertToCosmosAddress(managerWallet.address)
        }
      ],
      collectionApprovals: [
        new CollectionApproval({
          fromListId: 'All',
          toListId: 'All',
          initiatedByListId: 'All',
          transferTimes: UintRangeArray.FullRanges(),
          badgeIds: UintRangeArray.FullRanges(),
          ownershipTimes: UintRangeArray.FullRanges(),
          approvalId: crypto.randomBytes(32).toString('hex')
        })
      ],
      collectionPermissions: {
        ...sampleMsgCreateCollection.collectionPermissions,
        canUpdateCollectionApprovals: [
          {
            fromListId: 'All',
            toListId: 'All',
            initiatedByListId: 'All',
            approvalId: 'All',
            ownershipTimes: UintRangeArray.FullRanges(),
            badgeIds: UintRangeArray.FullRanges(),
            transferTimes: UintRangeArray.FullRanges(),

            permanentlyForbiddenTimes: UintRangeArray.FullRanges(),
            permanentlyPermittedTimes: []
          }
        ]
      }
    })
      .convert(BigIntify)
      .toProto();

    const txRes = await signAndBroadcast([msg], managerWallet);
    console.log(txRes);

    const msgResponse = txRes.data;
    let collectionId = 0;
    if (
      msgResponse.tx_response.logs[0]?.events[0]?.attributes[0]?.key === 'action' &&
      msgResponse.tx_response.logs[0]?.events[0]?.attributes[0]?.value === '/badges.MsgUniversalUpdateCollection'
    ) {
      const collectionIdStr = msgResponse.tx_response.logs[0]?.events[1].attributes.find((attr: any) => attr.key === 'collectionId')?.value;
      if (collectionIdStr) {
        collectionId = Numberify(collectionIdStr);
      }
    }
    const approvalMsg = new MsgUpdateUserApprovals<NumberType>({
      creator: convertToCosmosAddress(wallet.address),
      collectionId: collectionId,
      updateOutgoingApprovals: true,
      outgoingApprovals: [
        new UserOutgoingApproval({
          toListId: 'All',
          initiatedByListId: 'All',
          transferTimes: UintRangeArray.FullRanges(),
          badgeIds: UintRangeArray.FullRanges(),
          ownershipTimes: UintRangeArray.FullRanges(),
          approvalId: crypto.randomBytes(32).toString('hex'),
          approvalCriteria: {
            merkleChallenges: [
              {
                //Don't care about core details now
                root: 'fhjadsfkja',
                expectedProofLength: 2n,
                uri: '',
                customData: '',
                useCreatorAddressAsLeaf: false,
                maxUsesPerLeaf: 1n,

                //We do care about these
                challengeTrackerId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? ''
              }
            ]
          }
        })
      ],
      updateAutoApproveSelfInitiatedIncomingTransfers: false,
      updateAutoApproveSelfInitiatedOutgoingTransfers: false,
      updateIncomingApprovals: false,
      updateUserPermissions: false,
      userPermissions: {
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: []
      },
      autoApproveSelfInitiatedIncomingTransfers: false,
      autoApproveSelfInitiatedOutgoingTransfers: false,
      incomingApprovals: []
    }).toProto();

    const txRes2 = await signAndBroadcast([approvalMsg], wallet);
    console.log(txRes2);

    //Sleep 10 seconds to allow it to claim
    await new Promise((r) => setTimeout(r, 4000));

    const claimDoc = await mustGetFromDB(ClaimBuilderModel, body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');
    expect(Number(claimDoc.collectionId)).toBeGreaterThan(0);
    expect(claimDoc.docClaimed).toBeTruthy();
    expect(claimDoc.trackerDetails).toBeTruthy();
    expect(claimDoc.trackerDetails?.challengeTrackerId).toBe(body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '');
    expect(claimDoc.trackerDetails?.approvalLevel).toBe('outgoing');
    expect(claimDoc.trackerDetails?.approverAddress).toBe(convertToCosmosAddress(wallet.address));

    //Try and update it (on-chain permissions allow it)
    const route2 = BitBadgesApiRoutes.AddApprovalDetailsToOffChainStorageRoute();
    const body2: AddApprovalDetailsToOffChainStoragePayload = {
      approvalDetails: [
        {
          name: 'test',
          description: 'hajkdsfkasd',
          challengeInfoDetails: [
            {
              challengeDetails: {
                leaves: generateCodesFromSeed(seedCode, 10).map((x) => SHA256(x).toString()),
                preimages: generateCodesFromSeed(seedCode, 10),
                numLeaves: 10,
                isHashed: true
              },
              claim: {
                claimId: body.approvalDetails[0].challengeInfoDetails?.[0].claim?.claimId ?? '',
                seedCode: seedCode,
                plugins: [
                  {
                    ...numUsesPlugin(10, 0)
                  },
                  {
                    ...codesPlugin(10, crypto.randomBytes(32).toString('hex')),

                    resetState: true
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res2 = await request(app)
      .post(route2)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(wallet.address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res2.body);
    expect(res2.status).toBe(200);

    //Try another user
    const res3 = await request(app)
      .post(route2)
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    console.log(res3.body);
    expect(res3.status).toBeGreaterThan(400);
  }, 100000);
});
