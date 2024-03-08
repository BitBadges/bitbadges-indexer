import { BitBadgesApiRoutes, CheckAndCompleteClaimRouteRequestBody, convertToCosmosAddress } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { ClaimBuilderModel } from '../db/schemas';
import request from 'supertest';
import { MongoDB, insertToDB, mustGetFromDB } from '../db/db';
import app, { gracefullyShutdown } from '../indexer';
import { createExampleReqForAddress } from '../testutil/utils';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;

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
    const randomDocId = crypto.randomBytes(32).toString('hex');

    await insertToDB(ClaimBuilderModel, {
      _docId: randomDocId,
      action: {
        seedCode: 'U2FsdGVkX1+iqwjCpOvPQCgLkBgVf7nvmHUGSTjxFSZkSSvT7RQV0wlMuVyQXYocdN7ejqk2HF9sij2FpVYpsNqW6asX8dSXZt0BYuBD6SKQyylA75UTBrb45wEpk0F8'
      },
      cid: randomDocId,
      collectionId: 85,
      createdBy: 'cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x',
      docClaimed: true,
      plugins: [
        {
          id: 'requiresProofOfAddress',
          publicParams: {},
          privateParams: {},
          publicState: {}
        },
        {
          id: 'numUses',
          publicParams: {
            maxUses: 10,
            maxUsesPerAddress: 2
          },
          privateParams: {},
          publicState: {
            numUses: 0,
            claimedUsers: {}
          }
        },
        {
          id: 'codes',
          publicParams: {
            numCodes: 10
          },
          privateParams: {
            codes: [],
            seedCode:
              'U2FsdGVkX19pHYGSzuSoR657InwNBS0DcvmPjThbgeIDW6PO3VHfPgUeXz4xXqOCuQlLtmx0bGIulczRz9z/6+6CTloFvirTrHoHNWeUharnzHNg+LfXqjQ+bDiiHjh9'
          },
          publicState: {
            usedCodes: []
          },
          resetState: true
        }
      ],
      state: {
        requiresProofOfAddress: {},
        numUses: {
          claimedUsers: {},
          currCode: 0
        },
        codes: {
          usedCodes: {}
        }
      }
    });

    //c45cecd74e1c8cfd315f400c82a08cf59ef63c2d4bf19e1c74bc0e56eba052be
    const route = BitBadgesApiRoutes.CheckAndCompleteClaimRoute(randomDocId, convertToCosmosAddress(wallet.address));
    const body: CheckAndCompleteClaimRouteRequestBody = {
      codes: {
        code: 'c45cecd74e1c8cfd315f400c82a08cf59ef63c2d4bf19e1c74bc0e56eba052be'
      }
    };

    const promises = [];

    for (let i = 0; i < 100; i++) {
      promises.push(
        request(app)
          .post(route)
          .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
          .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
          .send(body)
      );
    }

    await Promise.all(promises);

    const finalDoc = await mustGetFromDB(ClaimBuilderModel, randomDocId);
    expect(finalDoc.state.numUses.currCode).toBe(1);

    // const res = await request(app)
    //   .post(route)
    //   .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
    //   .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
    //   .send(body);
    // expect(res.status).toBe(200);

    // const res2 = await request(app)
    //   .post(route)
    //   .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
    //   .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
    //   .send(body);
    // expect(res2.status).toBe(400);

    // const finalDoc = await mustGetFromDB(ClaimBuilderModel, randomDocId);
    // expect(finalDoc.state.numUses.currCode).toBe(1);
  }, 30000);
});
