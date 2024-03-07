import {
  BitBadgesApiRoutes,
  type CreateBlockinAuthCodeRouteRequestBody,
  type DeleteBlockinAuthCodeRouteRequestBody,
  type GetBlockinAuthCodeRouteRequestBody
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
const exampleSession = createExampleReqForAddress(address).session;
const message = exampleSession.blockin ?? '';
let signature = '';

describe('get auth codes', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}

    signature = await wallet.signMessage(message ?? '');
  });

  afterAll(async () => {
    await gracefullyShutdown();
  });

  it('should create auth code in storage', async () => {
    const route = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const body: CreateBlockinAuthCodeRouteRequestBody = {
      message,
      signature,
      name: 'test',
      image: '',
      description: ''
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const invalidSigRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ ...body, signature: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    const getResRoute = BitBadgesApiRoutes.GetAuthCodeRoute();
    const getResBody: GetBlockinAuthCodeRouteRequestBody = { signature };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.message).toBeDefined();

    const invalidGetRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ signature: 'invalid' });
    expect(invalidGetRes.status).toBe(500);

    const unauthorizedDeleteRes = await request(app)
      .post(BitBadgesApiRoutes.DeleteAuthCodeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ signature });
    expect(unauthorizedDeleteRes.status).toBe(401);

    const deleteResRoute = BitBadgesApiRoutes.DeleteAuthCodeRoute();
    const deleteResBody: DeleteBlockinAuthCodeRouteRequestBody = { signature };
    const deleteRes = await request(app)
      .post(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteResBody);
    expect(deleteRes.status).toBe(200);
  });
});
