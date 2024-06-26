import {
  BitBadgesApiRoutes,
  GetClaimAlertsForCollectionPayload,
  ManagerTimeline,
  SendClaimAlertsPayload,
  UintRangeArray,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { insertToDB, mustGetFromDB } from '../db/db';
import { CollectionModel } from '../db/schemas';

import { createExampleReqForAddress } from '../testutil/utils';
import { Express } from 'express';
const app = (global as any).app as Express;

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
// const exampleSession = createExampleReqForAddress(address).session;
// const message = exampleSession.blockin ?? '';

describe('claim alerts', () => {
  beforeAll(async () => {
    console.log('app', (global as any).app);
  });

  it('should send claim alert', async () => {
    const route = BitBadgesApiRoutes.SendClaimAlertRoute();
    const body: SendClaimAlertsPayload = {
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
    const body: SendClaimAlertsPayload = {
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
    const body: SendClaimAlertsPayload = {
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
    console.log(res.body);

    expect(res.status).toBe(200);

    const getRoute = BitBadgesApiRoutes.GetClaimAlertsRoute();
    const getPayload: GetClaimAlertsForCollectionPayload = {
      collectionId: 1,
      bookmark: ''
    };

    const getRes = await request(app)
      .post(getRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getPayload);
    expect(getRes.status).toBe(200);
    expect(getRes.body.claimAlerts.length).toBeGreaterThan(0);

    await insertToDB(CollectionModel, { ...collectionDoc, managerTimeline: currManagerTimeline }); //reset to avoid side effects
  });

  // it('should not work w/o scopes', async () => {
  //   const route = BitBadgesApiRoutes.SendClaimAlertRoute();
  //   const body: SendClaimAlertsPayload = {
  //     claimAlerts: [
  //       {
  //         collectionId: 0,
  //         message: 'test',
  //         cosmosAddresses: [address]
  //       }
  //     ]
  //   };

  //   const res = await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .send(body);

  //   expect(res.status).toBe(401);

  //   const res2 = await request(app)
  //     .post(route)
  //     .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
  //     .set(
  //       'x-mock-session',
  //       JSON.stringify({
  //         ...createExampleReqForAddress(address).session,
  //         blockinParams: {
  //           ...createExampleReqForAddress(address).session.blockinParams,
  //           resources: ['something random']
  //         }
  //       })
  //     )
  //     .send(body);
  //   expect(res2.status).toBe(401);
  // });
});
