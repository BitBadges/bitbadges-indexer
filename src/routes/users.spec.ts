import {
  AccountViewKey,
  BitBadgesApiRoutes,
  BitBadgesUserInfo,
  GetAccountsPayload,
  NotificationPreferences,
  SocialConnections,
  convertToCosmosAddress,
  type UpdateAccountInfoPayload
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Express } from 'express';
import request from 'supertest';
import { insertToDB, mustGetFromDB } from '../db/db';
import { ProfileModel } from '../db/schemas';
import { createExampleReqForAddress } from '../testutil/utils';
const app = (global as any).app as Express;

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

describe('users', () => {
  it('should create user profile in storage', async () => {
    const route = BitBadgesApiRoutes.UpdateAccountInfoRoute();
    const randomUsername = Math.random().toString(36).substring(7);
    const body: UpdateAccountInfoPayload = {
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
  }, 30000);

  it('should unset if empty strings are sent', async () => {
    const route = BitBadgesApiRoutes.UpdateAccountInfoRoute();
    const body: UpdateAccountInfoPayload = {
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
    const body: UpdateAccountInfoPayload = {
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

  it('should throw on fetching attestation values while unauthenticated', async () => {
    const getRoute = BitBadgesApiRoutes.GetAccountsRoute();
    const problemViews: AccountViewKey[] = ['siwbbRequests', 'privateLists', 'receivedAttestations', 'createdAttestations'];
    for (const view of problemViews) {
      const getPayload: GetAccountsPayload = {
        accountsToFetch: [
          {
            address: convertToCosmosAddress(address),
            viewsToFetch: [{ viewType: view, viewId: view, bookmark: '' }]
          }
        ]
      };

      const getRes = await request(app)
        .post(getRoute)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .set('x-mock-session', JSON.stringify({}))
        .send(getPayload);

      expect(getRes.status).toBeGreaterThan(401);

      const successRes = await request(app)
        .post(getRoute)
        .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
        .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
        .send(getPayload);
      expect(successRes.status).toBe(200);
    }
  });

  it('should not return private profile details if unauthenticated', async () => {
    const getRoute = BitBadgesApiRoutes.GetAccountsRoute();
    const getPayload: GetAccountsPayload = {
      accountsToFetch: [
        {
          address: convertToCosmosAddress(address)
        }
      ]
    };

    const profileDoc = await mustGetFromDB(ProfileModel, convertToCosmosAddress(address));
    profileDoc.notifications = new NotificationPreferences({});
    profileDoc.socialConnections = new SocialConnections({ discord: { username: 'test', id: 'test', lastUpdated: 1n } });
    profileDoc.approvedSignInMethods = {
      discord: { username: 'test', id: 'test', scopes: [{ scopeName: 'Complete Claims' }] }
    };
    await insertToDB(ProfileModel, profileDoc);

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify({}))
      .send(getPayload);

    expect(getRes.status).toBe(200);

    const account = new BitBadgesUserInfo(getRes.body.accounts[0]);
    expect(account.socialConnections).toBeFalsy();
    expect(account.notifications).toBeFalsy();
    expect(account.approvedSignInMethods).toBeFalsy();

    const successRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload);

    expect(successRes.status).toBe(200);

    const successAccount = new BitBadgesUserInfo(successRes.body.accounts[0]);
    expect(successAccount.socialConnections).toBeTruthy();
    expect(successAccount.notifications).toBeTruthy();
    expect(successAccount.approvedSignInMethods).toBeTruthy();
  });
});
