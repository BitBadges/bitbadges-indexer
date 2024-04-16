import request from 'supertest';
import app, { server } from '../indexer';

import {
  BitBadgesApiRoutes,
  BlockinChallengeParams,
  GetClaimAlertsForCollectionRouteRequestBody,
  GetSignInChallengeRouteSuccessResponse,
  ProfileDoc,
  UintRangeArray,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import { ChallengeParams, createChallenge } from 'blockin';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import mongoose from 'mongoose';
import { MongoDB, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { CollectionModel, ProfileModel } from '../db/schemas';
import { connectToRpc } from '../poll';
import { createExampleReqForAddress } from '../testutil/utils';
import { BlockinSession, MaybeAuthenticatedRequest, statement } from './blockin_handlers';
import { verifyBitBadgesAssets } from './verifyBitBadgesAssets';

connectToRpc();
dotenv.config();

const challengeParams: ChallengeParams<bigint> = {
  domain: 'https://bitbadges.io',
  statement,
  address: 'exampleAddress',
  uri: 'https://bitbadges.io',
  nonce: 'exampleNonce',
  expirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
  notBefore: undefined,
  resources: ['Full Access: This sign-in gives full access to all features.'],
  assetOwnershipRequirements: undefined
};

const exampleReq: MaybeAuthenticatedRequest<bigint> = {
  session: {
    blockin: createChallenge(challengeParams),
    blockinParams: challengeParams,
    cosmosAddress: 'exampleCosmosAddress',
    address: 'exampleAddress',
    nonce: 'exampleNonce'
  } as BlockinSession<bigint>
} as MaybeAuthenticatedRequest<bigint>;

describe('checkIfAuthenticated function', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    console.log('Waiting for MongoDB to be ready');

    while (!MongoDB.readyState) {
      console.log('Waiting for MongoDB to be ready');
    }
    await connectToRpc();
    console.log('MongoDB is ready');
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(console.error);
    // shut down server
    server?.close();
  });

  test('responds to /', async () => {
    // set header x-api-key
    const res = await request(app)
      .get('/')
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '');
    expect(res.header['content-type']).toBe('application/json; charset=utf-8');
    expect(res.statusCode).toBe(200);
  });

  // it('should return true if all session properties are present and match', () => {
  //   // Mock session object with all required properties
  //   const req: MaybeAuthenticatedRequest<bigint> = {
  //     ...exampleReq
  //   } as MaybeAuthenticatedRequest<bigint>;
  //   expect(checkIfAuthenticated(req)).toBeTruthy();
  // });

  // it('should return false if session properties are missing', () => {
  //   // Mock session object missing some required properties
  //   const req = {
  //     ...exampleReq,
  //     session: { ...exampleReq.session, cosmosAddress: undefined }
  //   } as MaybeAuthenticatedRequest<bigint>;
  //   expect(checkIfAuthenticated(req)).toBeFalsy();
  // });

  it('should add a report which is an authenticated request', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(exampleReq.session))
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });
    expect(res.statusCode).toBe(200);
  });

  it('should not add a report with no scopes', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify({ ...exampleReq.session, blockinParams: { ...exampleReq.session.blockinParams, resources: [] } }))
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });
    expect(res.statusCode).toBe(401);
  });

  it('should not add report with wrong scope', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({ ...exampleReq.session, blockinParams: { ...exampleReq.session.blockinParams, resources: ['Wrong Scope'] } })
      )
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });
    expect(res.statusCode).toBe(401);
  });

  it('should not add a report w/o a session', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });

    expect(res.statusCode).toBe(401);
  });

  it('should add a report w/ the correct scope', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...exampleReq.session,
          blockinParams: { ...exampleReq.session.blockinParams, resources: ['Report: Report users or collections.'] }
        })
      )
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });

    expect(res.statusCode).toBe(200);
  });

  it('should not add a report w/ the correct scope but incorrect message', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const reportRoute = '/api/v0/report';
    const res = await request(app)
      .post(reportRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...exampleReq.session,
          blockinParams: { ...exampleReq.session.blockinParams, resources: ['Report: This is a malicious message.'] }
        })
      )
      .send({
        collectionId: '1',
        addressOrUsername: 'exampleAddressOrUsername',
        reason: 'exampleReason'
      });

    expect(res.statusCode).toBe(401);
  });

  it('should pass manager route with a session', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const collectionId = 1;
    const managerRoute = BitBadgesApiRoutes.GetClaimAlertsRoute();
    const body: GetClaimAlertsForCollectionRouteRequestBody = { collectionId: collectionId.toString(), bookmark: '' };
    const collectionDoc = await mustGetFromDB(CollectionModel, '1');

    const managerReq = createExampleReqForAddress(collectionDoc.managerTimeline[0].manager);
    const res = await request(app)
      .post(managerRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(managerReq.session))
      .send(body);

    expect(res.statusCode).toBe(200);
  });

  it('should fail manager route with a non-manager address', async () => {
    // Mock session object with all required properties
    // const req = { ...exampleReq } as MaybeAuthenticatedRequest<bigint>;
    // Set up a mock session middleware

    const collectionId = 1;
    const managerRoute = BitBadgesApiRoutes.GetClaimAlertsRoute();
    const body: GetClaimAlertsForCollectionRouteRequestBody = { collectionId: collectionId.toString(), bookmark: '' };
    const managerReq = createExampleReqForAddress('differentAddress');
    const res = await request(app)
      .post(managerRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(managerReq.session))
      .send(body);

    expect(res.statusCode).toBe(401);
  });

  it('basic auth flow should work', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    const messageToSign = challenge.message;
    const signature = await ethWallet.signMessage(messageToSign);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: messageToSign, signature });
    expect(verifyRes.statusCode).toBe(200);

    const invalidVerifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: messageToSign, signature: 'manipulated signature' });
    expect(invalidVerifyRes.statusCode).toBe(401);
  });

  it('should not work with other domains', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    challenge.message = challenge.message.replace('bitbadges.io', 'manipulated.io');
    challenge.params.uri = challenge.params.uri.replace('bitbadges.io', 'manipulated.io');
    challenge.params.domain = challenge.params.domain.replace('bitbadges.io', 'manipulated.io');

    const messageToSign = challenge.message;
    const signature = await ethWallet.signMessage(messageToSign);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: messageToSign, signature });
    expect(verifyRes.statusCode).toBe(401);
  });

  it('should not work with other statement', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    challenge.params.statement = 'manipulated statement';
    challenge.message = createChallenge(challenge.params);

    const messageToSign = challenge.message;
    const signature = await ethWallet.signMessage(messageToSign);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: messageToSign, signature });
    expect(verifyRes.statusCode).toBe(401);
  });

  it('generic sign in flow should work with asset reqs', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('generic sign in flow should not work with unmet asset reqs', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 1n, end: 1n }
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 1 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('generic sign in should work with AND requirements', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        $and: [
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 1n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 0n, end: 0n }
              }
            ]
          },
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 2n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 0n, end: 0n }
              }
            ]
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1 and asset 2
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should fail with unmet AND requirements', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        $and: [
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 1n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 0n, end: 0n }
              }
            ]
          },
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 2n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 1n, end: 1n }
              }
            ]
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1 and 1 of asset 2
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with OR requirements', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        $or: [
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 1n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 0n, end: 0n }
              }
            ]
          },
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 2n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 1n, end: 1n }
              }
            ]
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1 or asset 2
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should fail with unmet OR requirements', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        $or: [
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 1n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 1n, end: 1n }
              }
            ]
          },
          {
            assets: [
              {
                chain: 'BitBadges',
                collectionId: 2n,
                assetIds: [{ start: 1n, end: 1n }],
                ownershipTimes: UintRangeArray.FullRanges(),
                mustOwnAmounts: { start: 1n, end: 1n }
              }
            ]
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 1 of asset 1 or asset 2
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with numMatchesForVerification', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1000n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ],
        options: { numMatchesForVerification: 1n }
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should work with unmet numMatchesForVerification', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1000n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 1n, end: 1n }
          }
        ],
        options: { numMatchesForVerification: 1n }
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with unmet numMatchesForVerification > num assets', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1000n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ],
        options: { numMatchesForVerification: 1001n }
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with unmet numMatchesForVerification > num assets', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1000n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ],
        options: { numMatchesForVerification: 1000n }
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should work with unmet numMatchesForVerification == num assets - 1', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 1n,
            assetIds: [{ start: 1n, end: 1000n }],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ],
        options: { numMatchesForVerification: 999n }
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    // Must own 0 of asset 1
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should work with passed in options', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({ ...session.session.blockinParams });
    params.issuedAt = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // issued too long ago
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature, options: { issuedAtTimeWindowMs: 5000 } });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);

    const challengeRes2 = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes2.body);
    expect(challengeRes2.statusCode).toBe(200);
  });

  it('should work with address lists', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 'BitBadges Lists',
            assetIds: ['All'],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 1n, end: 1n }
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(200);
  });

  it('should work with address lists', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'BitBadges',
            collectionId: 'BitBadges Lists',
            assetIds: ['All'],
            ownershipTimes: UintRangeArray.FullRanges(),
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ]
      }
    });
    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });
    console.log(challengeRes.body);
    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with Ethereum assets', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'Ethereum',
            collectionId: '0xc0cb81c1f89ab0873653f67eea42652f13cd8416',
            assetIds: ['4531'],
            ownershipTimes: [],
            mustOwnAmounts: { start: 0n, end: 0n }
          }
        ]
      }
    });

    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    console.log('testing');

    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });

    expect(challengeRes.statusCode).toBe(200);
  });

  it('should work with Ethereum assets', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const session = createExampleReqForAddress(ethWallet.address);
    if (!session.session.blockinParams) throw new Error('No blockinParams found in session');
    const params = new BlockinChallengeParams<bigint>({
      ...session.session.blockinParams,
      assetOwnershipRequirements: {
        assets: [
          {
            chain: 'Ethereum',
            collectionId: '0xc0cb81c1f89ab0873653f67eea42652f13cd8416',
            assetIds: ['4531'],
            ownershipTimes: [],
            mustOwnAmounts: { start: 1n, end: 1n }
          }
        ]
      }
    });

    const challenge = createChallenge(params);
    const messageToSign = challenge;
    const signature = await ethWallet.signMessage(messageToSign);

    console.log('testing');

    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GenericVerifyRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: challenge, signature });

    expect(challengeRes.statusCode).toBe(401);
  });

  it('should work with valid Ethereum NFT ', async () => {
    await verifyBitBadgesAssets(
      {
        $and: [
          {
            assets: [
              {
                chain: 'Ethereum',
                collectionId: '0xc0cb81c1f89ab0873653f67eea42652f13cd8416',
                assetIds: ['4531'],
                ownershipTimes: [],
                mustOwnAmounts: { start: 1n, end: 1n }
              }
            ]
          }
        ]
      },
      'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu'
    );

    try {
      await verifyBitBadgesAssets(
        {
          $and: [
            {
              assets: [
                {
                  chain: 'Ethereum',
                  collectionId: '0xc0cb81c1f89ab0873653f67eea42652f13cd8416',
                  assetIds: ['4531'],
                  ownershipTimes: [],
                  mustOwnAmounts: { start: 0n, end: 0n }
                }
              ]
            }
          ]
        },
        '0xe00dD9D317573f7B4868D8f2578C65544B153A27'
      );

      fail('Should not have been able to verify');
    } catch (e) {
      console.log(e);
    }
  });

  it('should work with valid Polygon asset', async () => {
    await verifyBitBadgesAssets(
      {
        $and: [
          {
            assets: [
              {
                chain: 'Polygon',
                collectionId: '0x9a7f0b7d4b6c1c3f3b6d4e6d5b6e6d5b6e6d5b6e',
                assetIds: ['1'],
                ownershipTimes: [],
                mustOwnAmounts: { start: 0n, end: 0n }
              }
            ]
          }
        ]
      },
      'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu'
    );

    try {
      await verifyBitBadgesAssets(
        {
          $and: [
            {
              assets: [
                {
                  chain: 'Polygon',
                  collectionId: '0x9a7f0b7d4b6c1c3f3b6d4e6d5b6e6d5b6e6d5b6e',
                  assetIds: ['1'],
                  ownershipTimes: [],
                  mustOwnAmounts: { start: 1n, end: 1n }
                }
              ]
            }
          ]
        },
        '0xe00dD9D317573f7B4868D8f2578C65544B153A27'
      );

      fail('Should not have been able to verify');
    } catch (e) {
      console.log(e);
    }
  });

  it('should work with sign ins and sign outs', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    const messageToSign = challenge.message;
    const signature = await ethWallet.signMessage(messageToSign);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ message: messageToSign, signature });
    expect(verifyRes.statusCode).toBe(200);

    const signOutRes = await request(app)
      .post(BitBadgesApiRoutes.SignOutRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    expect(signOutRes.statusCode).toBe(200);

    const signInStatusRoute = BitBadgesApiRoutes.CheckIfSignedInRoute();
    const signInStatusRes = await request(app)
      .post(signInStatusRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    expect(signInStatusRes.statusCode).toBe(200);
    expect(signInStatusRes.body.signedIn).toBe(false);
  });

  it('should approve discord sign in if set', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    const messageToSign = challenge.message;

    const profileDoc =
      (await getFromDB(ProfileModel, convertToCosmosAddress(address))) ??
      new ProfileDoc({
        _docId: convertToCosmosAddress(address)
      });
    profileDoc.approvedSignInMethods = {
      discord: {
        id: '123456789',
        username: 'test',
        discriminator: '0'
      }
    };
    await insertToDB(ProfileModel, profileDoc);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          discord: {
            id: '123456789',
            username: 'test',
            discriminator: '0'
          }
        })
      )
      .send({ message: messageToSign });
    expect(verifyRes.statusCode).toBe(200);
  });

  it('should not approve discord sign in if set but not matching', async () => {
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const challengeRes = await request(app)
      .post(BitBadgesApiRoutes.GetSignInChallengeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ address });
    const challenge = new GetSignInChallengeRouteSuccessResponse(challengeRes.body);
    const messageToSign = challenge.message;

    const profileDoc =
      (await getFromDB(ProfileModel, convertToCosmosAddress(address))) ??
      new ProfileDoc({
        _docId: convertToCosmosAddress(address)
      });
    profileDoc.approvedSignInMethods = {
      discord: {
        id: '123456789',
        username: 'test',
        discriminator: '0'
      }
    };
    await insertToDB(ProfileModel, profileDoc);

    const verifyRes = await request(app)
      .post(BitBadgesApiRoutes.VerifySignInRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          discord: {
            id: '123456789',
            username: 'test',
            discriminator: '1'
          }
        })
      )
      .send({ message: messageToSign });
    expect(verifyRes.statusCode).toBe(401);
  });
});
