import {
  BitBadgesApiRoutes,
  BlockinAndGroup,
  BlockinAssetConditionGroup,
  CheckAndCompleteClaimRouteRequestBody,
  ClaimIntegrationPluginType,
  IntegrationPluginDetails,
  NumberType,
  UintRangeArray,
  convertToCosmosAddress,
  iAddressList,
  iClaimBuilderDoc,
  iUintRange
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { AES } from 'crypto-js';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AddressListModel, ClaimBuilderModel } from '../db/schemas';
import app, { gracefullyShutdown } from '../indexer';
import { generateCodesFromSeed } from '../integrations/codes';
import { getPlugin } from '../integrations/types';
import { createExampleReqForAddress } from '../testutil/utils';
import { findInDB } from '../db/queries';
import { getDecryptedActionCodes } from './claims';

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

const numUsesPlugin = (
  maxUses: number,
  maxUsesPerAddress: number,
  assignMethod: 'firstComeFirstServe' | 'codeIdx' = 'firstComeFirstServe'
): IntegrationPluginDetails<'numUses'> => {
  return {
    id: 'numUses',
    publicParams: {
      maxUses,
      maxUsesPerAddress,
      assignMethod
    },
    privateParams: {},
    publicState: getPlugin('numUses').getBlankPublicState()
  };
};

const codesPlugin = (numCodes: number, seedCode: string): IntegrationPluginDetails<'codes'> => {
  return {
    id: 'codes',
    publicParams: {
      numCodes
    },
    privateParams: {
      codes: [],
      seedCode: AES.encrypt(seedCode, process.env.SYM_KEY ?? '').toString()
    },
    publicState: {
      usedCodes: []
    },
    resetState: true
  };
};

const passwordPlugin = (password: string): IntegrationPluginDetails<'password'> => {
  return {
    id: 'password',
    publicParams: {},
    privateParams: {
      password: AES.encrypt(password, process.env.SYM_KEY ?? '').toString()
    },
    publicState: {},
    resetState: true
  };
};

const transferTimesPlugin = (transferTimes: iUintRange<number>): IntegrationPluginDetails<'transferTimes'> => {
  return {
    id: 'transferTimes',
    publicParams: {
      transferTimes: UintRangeArray.From(transferTimes)
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

const whitelistPlugin = (privateMode: boolean, list?: iAddressList, listId?: string): IntegrationPluginDetails<'whitelist'> => {
  return {
    id: 'whitelist',
    publicParams: privateMode
      ? {}
      : {
          list,
          listId
        },
    privateParams: privateMode
      ? {
          list,
          listId
        }
      : {},
    publicState: {},
    resetState: true
  };
};

const greaterThanXBADGEBalancePlugin = (greaterThan: number): IntegrationPluginDetails<'greaterThanXBADGEBalance'> => {
  return {
    id: 'greaterThanXBADGEBalance',
    publicParams: {
      minBalance: greaterThan
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

const discordPlugin = (usernames: string[]): IntegrationPluginDetails<'discord'> => {
  return {
    id: 'discord',
    publicParams: {
      users: usernames
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

const twitterPlugin = (usernames: string[]): IntegrationPluginDetails<'twitter'> => {
  return {
    id: 'twitter',
    publicParams: {
      users: usernames
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

const requiresProofOfAddressPlugin = (requiresProofOfAddress: boolean): IntegrationPluginDetails<'requiresProofOfAddress'> => {
  return {
    id: 'requiresProofOfAddress',
    publicParams: {},
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

const mustOwnBadgesPlugin = (ownershipReqs: BlockinAssetConditionGroup<NumberType>): IntegrationPluginDetails<'mustOwnBadges'> => {
  return {
    id: 'mustOwnBadges',
    publicParams: {
      ownershipRequirements: ownershipReqs
    },
    privateParams: {
      ownershipRequirements: { $and: [] }
    },
    publicState: {},
    resetState: true
  };
};

describe('claims', () => {
  beforeAll(async () => {
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
    expect(finalDoc.state.codes.usedCodes[codes[0]]).toBe(1);
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
          usedCodes: {}
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

  it('should work with greaterThanXBADGEBalance', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(0)]);
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

  it('should not work with greaterThanXBADGEBalance', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), greaterThanXBADGEBalancePlugin(1000)]);
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(doc._docId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {};

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(0);
  });

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
      .send(body);
    console.log(res.body);

    let finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.twitter['123456789']).toBe(1);

    await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    console.log(res.body);

    finalDoc = await mustGetFromDB(ClaimBuilderModel, doc._docId);
    expect(finalDoc.state.numUses.numUses).toBe(1);
    expect(finalDoc.state.twitter['123456789']).toBe(1);
  });

  it('should require signature', async () => {
    const doc = await createClaimDoc([numUsesPlugin(10, 0), requiresProofOfAddressPlugin(true)]);
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

  //TODO: Off-chain assignment checks
});
