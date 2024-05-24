import { BitBadgesApiRoutes, CreateDeveloperAppBody, UpdateDeveloperAppBody } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB, getFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { connectToRpc } from '../poll';
import { createExampleReqForAddress } from '../testutil/utils';
import { DeveloperAppModel } from '../db/schemas';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('auth apps', () => {
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

  it('should create and update auth apps', async () => {
    const route = BitBadgesApiRoutes.CreateDeveloperAppRoute();
    const body: CreateDeveloperAppBody = {
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

    const route2 = BitBadgesApiRoutes.UpdateDeveloperAppRoute();
    const body2: UpdateDeveloperAppBody = {
      clientId,
      name: 'test2',
      redirectUris: ['http://localhost:3000']
    };

    const nonSignedInRes = await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body2);
    expect(nonSignedInRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInRes = await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(body2);
    expect(altUserSignedInRes.status).toBeGreaterThanOrEqual(400);

    const res2 = await request(app)
      .post(route2)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body2);
    expect(res2.status).toBe(200);

    const route3 = BitBadgesApiRoutes.UpdateDeveloperAppRoute();
    const body3: UpdateDeveloperAppBody = {
      clientId,
      name: 'test2',
      redirectUris: ['http://localhost:3000']
    };

    const res3 = await request(app)
      .post(route3)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body3);
    expect(res3.status).toBe(200);

    const notSignedInDeleteRes = await request(app)
      .post(BitBadgesApiRoutes.DeleteDeveloperAppRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ clientId });

    expect(notSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const altUserSignedInDeleteRes = await request(app)
      .post(BitBadgesApiRoutes.DeleteDeveloperAppRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send({ clientId });

    expect(altUserSignedInDeleteRes.status).toBeGreaterThanOrEqual(400);

    const deleteRoute = BitBadgesApiRoutes.DeleteDeveloperAppRoute();
    const deleteBody = { clientId };
    const deleteRes = await request(app)
      .post(deleteRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteBody);
    expect(deleteRes.status).toBe(200);

    const finalDoc = await getFromDB(DeveloperAppModel, clientId);
    expect(finalDoc).toBeUndefined();
  });

  it('should get auth apps', async () => {
    const createRoute = BitBadgesApiRoutes.CreateDeveloperAppRoute();
    const createBody: CreateDeveloperAppBody = {
      name: 'test',
      description: '',
      image: '',
      redirectUris: ['http://localhost:3000']
    };

    const res = await request(app)
      .post(createRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createBody);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetDeveloperAppRoute();

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
