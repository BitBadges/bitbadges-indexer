import {
  BitBadgesApiRoutes,
  GetClaimAlertsForCollectionRouteRequestBody,
  ManagerTimeline,
  SendClaimAlertsRouteRequestBody,
  UintRangeArray,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { MongoDB, insertToDB, mustGetFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { connectToRpc } from '../poll';
import { createExampleReqForAddress } from '../testutil/utils';
import { CollectionModel } from '../db/schemas';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('claim alerts', () => {
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

  it('should send claim alert', async () => {
    const route = BitBadgesApiRoutes.SendClaimAlertRoute();
    const body: SendClaimAlertsRouteRequestBody = {
      claimAlerts: [
        {
          collectionId: 0,
          message: 'test',
          cosmosAddresses: [address]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);
  });

  it('should check manager if collectionId is not 0', async () => {
    const route = BitBadgesApiRoutes.SendClaimAlertRoute();
    const body: SendClaimAlertsRouteRequestBody = {
      claimAlerts: [
        {
          collectionId: 1,
          message: 'test',
          cosmosAddresses: [address]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(401);
  });

  it('should check manager and success if collectionId is 0 and is manager', async () => {
    const route = BitBadgesApiRoutes.SendClaimAlertRoute();
    const body: SendClaimAlertsRouteRequestBody = {
      claimAlerts: [
        {
          collectionId: 1,
          message: 'test',
          cosmosAddresses: [address]
        }
      ]
    };

    const collectionDoc = await mustGetFromDB(CollectionModel, '1');
    const currManagerTimeline = collectionDoc.managerTimeline;
    collectionDoc.managerTimeline = [
      new ManagerTimeline({
        manager: convertToCosmosAddress(address),
        timelineTimes: UintRangeArray.FullRanges()
      })
    ];
    await insertToDB(CollectionModel, collectionDoc);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetClaimAlertsRoute();
    const getBody: GetClaimAlertsForCollectionRouteRequestBody = {
      collectionId: 1,
      bookmark: ''
    };

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.claimAlerts.length).toBeGreaterThan(0);

    await insertToDB(CollectionModel, { ...collectionDoc, managerTimeline: currManagerTimeline }); //reset to avoid side effects
  });

  it('should not work w/o scopes', async () => {
    const route = BitBadgesApiRoutes.SendClaimAlertRoute();
    const body: SendClaimAlertsRouteRequestBody = {
      claimAlerts: [
        {
          collectionId: 0,
          message: 'test',
          cosmosAddresses: [address]
        }
      ]
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);

    expect(res.status).toBe(401);

    const res2 = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          blockinParams: {
            ...createExampleReqForAddress(address).session.blockinParams,
            resources: ['something random']
          }
        })
      )
      .send(body);
    expect(res2.status).toBe(401);
  });
});
