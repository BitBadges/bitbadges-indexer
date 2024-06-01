import {
  BitBadgesApiRoutes,
  GetAccountsPayload,
  OauthAuthorizePayload,
  OauthAuthorizeSuccessResponse,
  OauthTokenSuccessResponse,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Express } from 'express';
import request from 'supertest';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { DeveloperAppModel, ProfileModel } from '../db/schemas';
const app = (global as any).app as Express;

import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('oauth', () => {
  beforeAll(async () => {
    const devApp = await getFromDB(DeveloperAppModel, 'test');
    if (!devApp) {
      await insertToDB(DeveloperAppModel, {
        _docId: 'test',
        clientId: 'test',
        clientSecret: 'test',
        redirectUris: ['http://localhost:3000'],
        createdBy: 'test',
        name: 'test',
        description: 'test',
        image: 'test'
      });
    }
  }, 15000);

  it('should correctly authorize', async () => {
    const devApp = await mustGetFromDB(DeveloperAppModel, 'test');
    const route = BitBadgesApiRoutes.OauthAuthorizeRoute();
    const body: OauthAuthorizePayload = {
      response_type: 'code',
      client_id: devApp.clientId,
      redirect_uri: devApp.redirectUris[0],
      scopes: [{ scopeName: 'Read Profile' }]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    const response = res.body as OauthAuthorizeSuccessResponse;

    expect(res.status).toBe(200);

    const authCode = response.code;

    const exchangeRoute = BitBadgesApiRoutes.OauthTokenRoute();
    const exchangeBody = {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: devApp.clientId,
      client_secret: devApp.clientSecret,
      redirect_uri: devApp.redirectUris[0]
    };

    const exchangeRes = await request(app)
      .post(exchangeRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(exchangeBody);
    expect(exchangeRes.status).toBe(200);

    const exchangeResponse = exchangeRes.body as OauthTokenSuccessResponse;
    expect(exchangeResponse.accessToken).toBeDefined();
    expect(exchangeResponse.refreshToken).toBeDefined();

    const accountsRoute = BitBadgesApiRoutes.GetAccountsRoute();
    const accountsBody: GetAccountsPayload = {
      accountsToFetch: [
        {
          address: address
        }
      ]
    };

    const currProfileDoc = await getFromDB(ProfileModel, convertToCosmosAddress(address));
    if (!currProfileDoc) {
      await insertToDB(ProfileModel, {
        _docId: convertToCosmosAddress(address),
        cosmosAddress: convertToCosmosAddress(address),
        socialConnections: {}
      });
    } else {
      await insertToDB(ProfileModel, { ...currProfileDoc, socialConnections: {} });
    }

    const accountsRes = await request(app)
      .post(accountsRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('Authorization', `Bearer ${exchangeResponse.accessToken}`)
      .send(accountsBody);
    expect(accountsRes.status).toBe(200);

    const accountsResponse = accountsRes.body;
    expect(accountsResponse.accounts).toBeDefined();
    expect(accountsResponse.accounts.length).toBe(1);
    expect(accountsResponse.accounts[0].socialConnections).toBeDefined();

    //Try without auth token
    const accountsRes2 = await request(app)
      .post(accountsRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(accountsBody);
    expect(accountsRes2.status).toBe(200);
    expect(accountsRes2.body.accounts[0].socialConnections).toBeUndefined();

    //Test do not approve anything else than Read Profile
    const otherRoute = BitBadgesApiRoutes.GetClaimAlertsRoute();
    const otherBody = {};
    const otherRes = await request(app)
      .post(otherRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('Authorization', `Bearer ${exchangeResponse.accessToken}`)
      .send(otherBody);
    expect(otherRes.status).toBe(401);

    //Test revocation of the token
    const revokeRoute = BitBadgesApiRoutes.OauthRevokeRoute();
    const revokeBody = {
      token: exchangeResponse.accessToken
    };

    const revokeRes = await request(app)
      .post(revokeRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(revokeBody);
    expect(revokeRes.status).toBe(200);

    //Test token is revoked
    const accountsRes3 = await request(app)
      .post(accountsRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('Authorization', `Bearer ${exchangeResponse.accessToken}`)
      .send(accountsBody);
    expect(accountsRes3.status).toBe(200);
    expect(accountsRes3.body.accounts[0].socialConnections).toBeUndefined();

    //Try and redeem the refresh token
    const refreshRoute = BitBadgesApiRoutes.OauthTokenRoute();
    const refreshBody = {
      grant_type: 'refresh_token',
      refresh_token: exchangeResponse.refreshToken,
      client_id: devApp.clientId,
      client_secret: devApp.clientSecret,
      redirect_uri: devApp.redirectUris[0]
    };

    const refreshRes = await request(app)
      .post(refreshRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(refreshBody);
    expect(refreshRes.status).toBeGreaterThan(399);
  });

  it('should allow refresh tokens to be used', async () => {
    const devApp = await mustGetFromDB(DeveloperAppModel, 'test');
    const route = BitBadgesApiRoutes.OauthAuthorizeRoute();
    const body: OauthAuthorizePayload = {
      response_type: 'code',
      client_id: devApp.clientId,
      redirect_uri: devApp.redirectUris[0],
      scopes: [{ scopeName: 'Read Profile' }]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    const response = res.body as OauthAuthorizeSuccessResponse;

    expect(res.status).toBe(200);

    const authCode = response.code;

    const exchangeRoute = BitBadgesApiRoutes.OauthTokenRoute();
    const exchangeBody = {
      grant_type: 'authorization_code',
      code: authCode,
      client_id: devApp.clientId,
      client_secret: devApp.clientSecret,
      redirect_uri: devApp.redirectUris[0]
    };

    const exchangeRes = await request(app)
      .post(exchangeRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(exchangeBody);
    expect(exchangeRes.status).toBe(200);

    const exchangeResponse = exchangeRes.body as OauthTokenSuccessResponse;
    expect(exchangeResponse.accessToken).toBeDefined();
    expect(exchangeResponse.refreshToken).toBeDefined();

    const refreshRoute = BitBadgesApiRoutes.OauthTokenRoute();
    const refreshBody = {
      grant_type: 'refresh_token',
      refresh_token: exchangeResponse.refreshToken,
      client_id: devApp.clientId,
      client_secret: devApp.clientSecret,
      redirect_uri: devApp.redirectUris[0]
    };

    const refreshRes = await request(app)
      .post(refreshRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(refreshBody);
    expect(refreshRes.status).toBe(200);

    const refreshResponse = refreshRes.body as OauthTokenSuccessResponse;
    expect(refreshResponse.accessToken).toBeDefined();
    expect(refreshResponse.refreshToken).toBeDefined();
  });
});
