import { BitBadgesApiRoutes, type UpdateAccountInfoRouteRequestBody, convertToCosmosAddress } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { ProfileModel } from '../db/schemas';
import request from 'supertest';
import { MongoDB, mustGetFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

describe('get auth codes', () => {
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

  it('should create user profile in storage', async () => {
    const route = BitBadgesApiRoutes.UpdateAccountInfoRoute();
    const randomUsername = Math.random().toString(36).substring(7);
    const body: UpdateAccountInfoRouteRequestBody = {
      discord: 'test',
      twitter: 'test',
      github: 'test',
      telegram: 'test',
      seenActivity: 0n,
      readme: 'test',
      hiddenBadges: [],
      hiddenLists: [],
      customPages: { badges: [], lists: [] },
      watchlists: { badges: [], lists: [] },
      profilePicUrl: '',
      username: randomUsername,
      profilePicImageFile: '',
      notifications: { email: '', antiPhishingCode: '', preferences: {} }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    console.log(res);
    expect(res.status).toBe(200);

    const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(address));
    expect(profileDoc).toBeDefined();
    expect(profileDoc?.discord).toEqual('test');
    expect(profileDoc?.twitter).toEqual('test');
    expect(profileDoc?.github).toEqual('test');
    expect(profileDoc?.telegram).toEqual('test');
    expect(profileDoc?.username).toEqual(randomUsername);

    // Another user cannot update to same username
    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body);
    expect(res2.status).toBe(500);
    console.log('res2', res2.body);
  }, 30000);

  it('should unset if empty strings are sent', async () => {
    const route = BitBadgesApiRoutes.UpdateAccountInfoRoute();
    const body: UpdateAccountInfoRouteRequestBody = {
      discord: '',
      twitter: '',
      github: '',
      telegram: '',
      seenActivity: 0n,
      readme: '',
      hiddenBadges: [],
      hiddenLists: [],
      customPages: { badges: [], lists: [] },
      watchlists: { badges: [], lists: [] },
      profilePicUrl: '',
      username: '',
      profilePicImageFile: '',
      notifications: { email: '', antiPhishingCode: '', preferences: {} }
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(address));
    expect(profileDoc).toBeDefined();
    expect(profileDoc?.discord).toBeFalsy();
    expect(profileDoc?.twitter).toBeFalsy();
    expect(profileDoc?.github).toBeFalsy();
    expect(profileDoc?.telegram).toBeFalsy();
    expect(profileDoc?.username).toBeFalsy();
  });

  it('should ignore undefineds', async () => {
    // set to truthy
    const randomUsername = Math.random().toString(36).substring(7);
    const route = BitBadgesApiRoutes.UpdateAccountInfoRoute();
    const body: UpdateAccountInfoRouteRequestBody = {
      discord: 'test',
      twitter: 'test',
      github: 'test',
      telegram: 'test',
      seenActivity: 0n,
      readme: 'test',
      hiddenBadges: [],
      hiddenLists: [],
      customPages: { badges: [], lists: [] },
      watchlists: { badges: [], lists: [] },
      profilePicUrl: '',
      username: randomUsername,
      profilePicImageFile: '',
      notifications: { email: '', antiPhishingCode: '', preferences: {} }
    };

    let res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    // set to undefined
    body.discord = undefined;
    body.twitter = undefined;
    body.github = undefined;
    body.telegram = undefined;
    body.username = undefined;
    body.readme = undefined;

    res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(address));
    expect(profileDoc).toBeDefined();
    expect(profileDoc?.discord).toEqual('test');
    expect(profileDoc?.twitter).toEqual('test');
    expect(profileDoc?.github).toEqual('test');
    expect(profileDoc?.telegram).toEqual('test');
    expect(profileDoc?.username).toEqual(randomUsername);
    expect(profileDoc?.readme).toEqual('test');
  });
});
