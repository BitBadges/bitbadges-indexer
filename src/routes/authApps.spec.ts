import { BitBadgesApiRoutes, CreateDeveloperAppPayload, UpdateDeveloperAppPayload } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Express } from 'express';
import request from 'supertest';
import { getFromDB } from '../db/db';
import { DeveloperAppModel } from '../db/schemas';
import { createExampleReqForAddress } from '../testutil/utils';
const app = (global as any).app as Express;

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('auth apps', () => {
  it('should create and update auth apps', async () => {
    const route = BitBadgesApiRoutes.CRUDDeveloperAppRoute();
    const body: CreateDeveloperAppPayload = {
      name: 'test',
      description: '',
      image: '',
      redirectUris: ['http://localhost:3000']
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
    const { clientId } = res.body;

    const route2 = BitBadgesApiRoutes.CRUDDeveloperAppRoute();
    const body2: UpdateDeveloperAppPayload = {
      clientId,
      name: 'test2',
      redirectUris: ['http://localhost:3000']
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

    const route3 = BitBadgesApiRoutes.CRUDDeveloperAppRoute();
    const body3: UpdateDeveloperAppPayload = {
      clientId,
      name: 'test2',
      redirectUris: ['http://localhost:3000']
    };

    const res3 = await request(app)
      .put(route3)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body3);
    expect(res3.status).toBe(200);

    const notSignedInDeleteRes = await request(app)
      .delete(BitBadgesApiRoutes.CRUDDeveloperAppRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ clientId });

    expect(notSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInDeleteRes = await request(app)
      .delete(BitBadgesApiRoutes.CRUDDeveloperAppRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send({ clientId });

    expect(altUserSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const deleteRoute = BitBadgesApiRoutes.CRUDDeveloperAppRoute();
    const deletePayload = { clientId };
    const deleteRes = await request(app)
      .delete(deleteRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deletePayload);
    expect(deleteRes.status).toBe(200);

    const finalDoc = await getFromDB(DeveloperAppModel, clientId);
    expect(finalDoc).toBeUndefined();
  });

  it('should get auth apps', async () => {
    const createRoute = BitBadgesApiRoutes.CRUDDeveloperAppRoute();
    const createPayload: CreateDeveloperAppPayload = {
      name: 'test',
      description: '',
      image: '',
      redirectUris: ['http://localhost:3000']
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createPayload);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetDeveloperAppsRoute();

    const notSignedInRes = await request(app)
      .get(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '');

    expect(notSignedInRes.status).toBeGreaterThanOrEqual(400);

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session));

    expect(getRes.status).toBe(200);
    expect(getRes.body.developerApps.length).toBe(1);
    expect(getRes.body.developerApps[0].name).toBe('test');
  });
});
