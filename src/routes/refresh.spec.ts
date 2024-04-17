import { BitBadgesApiRoutes, RefreshMetadataRouteRequestBody } from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { RefreshModel } from '../db/schemas';
import request from 'supertest';
import { MongoDB, insertToDB, mustGetFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { connectToRpc } from '../poll';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('refresh status', () => {
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

  it('should fetch refresh status', async () => {
    const route = BitBadgesApiRoutes.GetRefreshStatusRoute(1);
    const body: RefreshMetadataRouteRequestBody = {};
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.errorDocs.find((x: any) => x.notificationType)).toBeUndefined();
  });

  it('should enforce refresh cooldown', async () => {
    const doc = await mustGetFromDB(RefreshModel, `1`);
    await insertToDB(RefreshModel, { ...doc, refreshRequestTime: 1n });

    const route = BitBadgesApiRoutes.RefreshMetadataRoute(1);
    const body: RefreshMetadataRouteRequestBody = {};
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res2.status).toBe(500);
  });
});
