import { blsCreateProof, blsSign, generateBls12381G2KeyPair } from '@mattrglobal/bbs-signatures';
import {
  BitBadgesApiRoutes,
  convertToCosmosAddress,
  CreateSecretRouteRequestBody,
  GetSecretRouteRequestBody,
  UpdateSecretRouteRequestBody,
  type CreateBlockinAuthCodeRouteRequestBody,
  type DeleteBlockinAuthCodeRouteRequestBody,
  type GetBlockinAuthCodeRouteRequestBody
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import request from 'supertest';
import { getFromDB, MongoDB, mustGetFromDB } from '../db/db';
import { AuthAppModel, OffChainSecretsModel } from '../db/schemas';
import app, { gracefullyShutdown } from '../indexer';
import { createExampleReqForAddress } from '../testutil/utils';
import { verifySecretsProofSignatures } from 'bitbadgesjs-sdk';
import { connectToRpc } from '../poll';
import { findInDB } from '../db/queries';

dotenv.config();

const wallet = ethers.Wallet.createRandom();
const address = wallet.address;
const exampleSession = createExampleReqForAddress(address).session;
const message = exampleSession.blockin ?? '';
let signature = '';

const proofOfIssuancePlaceholder = 'I approve the issuance of secrets signed with BBS+ INSERT_HERE as my own.\n\n';

//Note a lot of the verification lofic is in the Blockin tests

const generateProof = async (messages: string[]) => {
  const keyPair = await generateBls12381G2KeyPair();
  const dataIntegrityProof = await blsSign({
    keyPair: keyPair!,
    messages: messages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
  });
  return {
    keyPair,
    dataIntegrityProof
  };
};

const deriveProof = async (keyPair: any, messages: string[], dataIntegrityProof: Uint8Array) => {
  return await blsCreateProof({
    publicKey: keyPair?.publicKey ?? new Uint8Array(),
    revealed: [0],
    signature: dataIntegrityProof,
    messages: messages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8'))),
    nonce: Uint8Array.from(Buffer.from('nonce', 'utf8'))
  });
};

describe('get auth codes', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}

    await connectToRpc();

    signature = await wallet.signMessage(message ?? '');
  });

  afterAll(async () => {
    await gracefullyShutdown();
  });

  it('should not create auth code in storage without correct scope', async () => {
    const route = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const clientIdDocs = await findInDB(AuthAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateBlockinAuthCodeRouteRequestBody = {
      options: {},
      clientId,
      message,
      signature,
      name: 'test',
      image: '',
      description: '',
      secretsProofs: [
        {
          createdBy: '',
          secretMessages: ['test'],
          dataIntegrityProof: {
            signature: '',
            signer: ''
          },
          scheme: 'bbs',
          messageFormat: 'plaintext',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance: {
            message: '',
            signature: '',
            signer: ''
          }
        }
      ]
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          blockinParams: {
            ...createExampleReqForAddress(address).session.blockinParams,
            resources: []
          }
        })
      )
      .send(body);
    expect(res.status).toBeGreaterThan(400);
  });

  it('should create auth code in storage', async () => {
    const route = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const clientIdDocs = await findInDB(AuthAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateBlockinAuthCodeRouteRequestBody = {
      options: {},
      clientId,
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

    const authCodeId = res.body.code;
    console.log(res.body);

    const invalidSigRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ ...body, signature: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    const getResRoute = BitBadgesApiRoutes.GetAuthCodeRoute();
    const getResBody: GetBlockinAuthCodeRouteRequestBody = { code: authCodeId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    console.log(getRes);
    expect(getRes.status).toBe(200);
    expect(getRes.body.blockin.message).toBeDefined();

    const invalidGetRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ id: 'invalid' });
    expect(invalidGetRes.status).toBe(500);

    const unauthorizedDeleteRes = await request(app)
      .post(BitBadgesApiRoutes.DeleteAuthCodeRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ id: authCodeId });
    expect(unauthorizedDeleteRes.status).toBe(401);

    const deleteResRoute = BitBadgesApiRoutes.DeleteAuthCodeRoute();
    const deleteResBody: DeleteBlockinAuthCodeRouteRequestBody = { code: authCodeId };
    const deleteRes = await request(app)
      .post(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteResBody);
    expect(deleteRes.status).toBe(200);
  });

  it('should not allow deleting an unowned auth code', async () => {
    const route = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const clientIdDocs = await findInDB(AuthAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateBlockinAuthCodeRouteRequestBody = {
      options: {},
      clientId,
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

    const authCodeId = res.body.code;

    const deleteResRoute = BitBadgesApiRoutes.DeleteAuthCodeRoute();
    const deleteResBody: DeleteBlockinAuthCodeRouteRequestBody = { code: authCodeId };
    const deleteRes = await request(app)
      .post(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          cosmosAddress: 'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu'
        })
      )
      .send(deleteResBody);
    expect(deleteRes.status).toBe(500);
  });

  it('should check signature before creating auth code', async () => {
    const route = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const clientIdDocs = await findInDB(AuthAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateBlockinAuthCodeRouteRequestBody = {
      options: {},
      clientId,
      message,
      signature: 'invalid',
      name: 'test',
      image: '',
      description: ''
    };
    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(500);
  });

  it('should create secret in storage', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = wallet;
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      signer: ethWallet.address,
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
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
      .send({ ...body, dataIntegrityProof: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretRoute();
    const getResBody: GetSecretRouteRequestBody = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const createAuthCodeRoute = BitBadgesApiRoutes.CreateAuthCodeRoute();
    const clientIdDocs = await findInDB(AuthAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const createAuthCodeBody: CreateBlockinAuthCodeRouteRequestBody = {
      clientId,
      options: {},
      message,
      signature,
      name: 'test',
      image: '',
      description: ''
    };

    const derivedProof = await blsCreateProof({
      publicKey: keyPair?.publicKey ?? new Uint8Array(),
      revealed: [0],
      signature: dataIntegrityProof,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8'))),
      nonce: Uint8Array.from(Buffer.from('nonce', 'utf8'))
    });
    const newProofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const newProofOfIssuanceSignature = await ethWallet.signMessage(newProofOfIssuanceMessage);

    createAuthCodeBody.secretsProofs = [
      {
        ...getRes.body,
        proofOfIssuance: {
          message: newProofOfIssuanceMessage,
          signature: newProofOfIssuanceSignature,
          signer: ethWallet.address
        },
        dataIntegrityProof: {
          signature: Buffer.from(derivedProof).toString('hex'),
          signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
        },
        createdBy: getRes.body.createdBy
      }
    ];

    await verifySecretsProofSignatures(createAuthCodeBody.secretsProofs[0], true);

    const authCodeRes = await request(app)
      .post(createAuthCodeRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createAuthCodeBody);
    console.log(authCodeRes.body);
    expect(authCodeRes.status).toBe(200);

    const getAuthCodeResRoute = BitBadgesApiRoutes.GetAuthCodeRoute();
    const getAuthCodeResBody: GetBlockinAuthCodeRouteRequestBody = { code: authCodeRes.body.code };
    const getAuthCodeRes = await request(app)
      .post(getAuthCodeResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getAuthCodeResBody);
    expect(getAuthCodeRes.status).toBe(200);
    expect(getAuthCodeRes.body.blockin.message).toBeDefined();
    expect(getAuthCodeRes.body.blockin.secretsProofs).toBeDefined();
    expect(getAuthCodeRes.body.blockin.secretsProofs.length).toBe(1);
  });

  it('should fail w/ invalid proofs', async () => {
    const proof = await generateProof(['test']);
    const derivedProof = await deriveProof(proof.keyPair, ['test'], proof.dataIntegrityProof);
    console.log(derivedProof);

    const proofOfIssuance = {
      message: '',
      signature: '',
      signer: ''
    };
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    proofOfIssuance.message = proofOfIssuanceMessage;
    proofOfIssuance.signature = proofOfIssuanceSignature;
    proofOfIssuance.signer = ethWallet.address;

    await expect(
      verifySecretsProofSignatures({
        createdBy: convertToCosmosAddress(address),
        secretMessages: ['test'],
        dataIntegrityProof: {
          signature: 'invalid',
          signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
        },
        scheme: 'bbs',
        messageFormat: 'plaintext',
        name: 'test',
        description: 'test',
        image: 'test',
        proofOfIssuance
      })
    ).rejects.toThrow();

    await expect(
      verifySecretsProofSignatures({
        createdBy: convertToCosmosAddress(address),
        secretMessages: ['test'],
        dataIntegrityProof: {
          signature: Buffer.from(derivedProof).toString('hex'), //using derived proof as orig proof
          signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
        },
        scheme: 'bbs',
        messageFormat: 'plaintext',
        name: 'test',
        description: 'test',
        image: 'test',
        proofOfIssuance
      })
    ).rejects.toThrow();

    await expect(
      verifySecretsProofSignatures(
        {
          createdBy: convertToCosmosAddress(address),
          secretMessages: ['test'],
          dataIntegrityProof: {
            signature: Buffer.from(derivedProof).toString('hex'),
            signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
          },
          scheme: 'bbs',
          messageFormat: 'plaintext',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance
        },
        true
      )
    ).resolves.toBeUndefined();

    await expect(
      verifySecretsProofSignatures(
        {
          createdBy: convertToCosmosAddress(address),
          secretMessages: ['test'],
          dataIntegrityProof: {
            signature: Buffer.from(derivedProof).toString('hex'),
            signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
          },
          scheme: 'bbs',
          messageFormat: 'plaintext',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance: {
            message: 'invalid',
            signature: 'invalid',
            signer: 'invalid'
          }
        },
        true
      )
    ).rejects.toThrow();

    await expect(
      verifySecretsProofSignatures(
        {
          createdBy: convertToCosmosAddress(address),
          secretMessages: [],
          dataIntegrityProof: {
            signature: Buffer.from(proof.dataIntegrityProof).toString('hex'),
            signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
          },
          scheme: 'bbs',
          messageFormat: 'plaintext',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance
        },
        true
      )
    ).rejects.toThrow();
  });

  it('should correctly throw on derived proof malformed', async () => {
    const proof = await generateProof(['test']);
    const derivedProof = await deriveProof(proof.keyPair, ['test'], proof.dataIntegrityProof);

    const proofOfIssuance = {
      message: '',
      signature: '',
      signer: ''
    };
    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    proofOfIssuance.message = proofOfIssuanceMessage;
    proofOfIssuance.signature = proofOfIssuanceSignature;
    proofOfIssuance.signer = ethWallet.address;

    await expect(
      verifySecretsProofSignatures(
        {
          createdBy: convertToCosmosAddress(address),
          secretMessages: ['test'],
          dataIntegrityProof: {
            signature: Buffer.from('a' + derivedProof).toString('hex'),
            signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
          },
          scheme: 'bbs',
          messageFormat: 'plaintext',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance
        },
        true
      )
    ).rejects.toThrow();
  }, 10000);

  it('should correctly handle json messageFormat proofs verification', async () => {
    const proof = await generateProof(['{"test": "test"}']);
    const derivedProof = await deriveProof(proof.keyPair, ['{"test": "test"}'], proof.dataIntegrityProof);

    const proofOfIssuance = {
      message: '',
      signature: '',
      signer: ''
    };
    const ethWallet = ethers.Wallet.createRandom();
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    proofOfIssuance.message = proofOfIssuanceMessage;
    proofOfIssuance.signature = proofOfIssuanceSignature;
    proofOfIssuance.signer = ethWallet.address;

    await expect(
      verifySecretsProofSignatures(
        {
          createdBy: convertToCosmosAddress(ethWallet.address),
          secretMessages: ['{"test": "test"}'],
          dataIntegrityProof: {
            signature: Buffer.from(derivedProof).toString('hex'),
            signer: Buffer.from(proof.keyPair?.publicKey ?? '').toString('hex')
          },
          scheme: 'bbs',
          messageFormat: 'json',
          name: 'test',
          description: 'test',
          image: 'test',
          proofOfIssuance
        },
        true
      )
    ).resolves.toBeUndefined();
  });

  it('should update anchors correctly', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
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
      .send({ ...body, dataIntegrityProof: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretRoute();
    const getResBody: GetSecretRouteRequestBody = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const updateSecretRoute = BitBadgesApiRoutes.UpdateSecretRoute();
    const updateSecretBody: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc.anchors.length).toBe(1);
    expect(secretsDoc.anchors[0].txHash).toBe('test');

    const updateSecretBody2: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(address),
          delete: false
        }
      ]
    };

    const updateRes2 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody2);
    expect(updateRes2.status).toBe(200);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc2.holders.length).toBe(1);

    const updateSecretBody3: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(address),
          delete: true
        }
      ]
    };

    const updateRes3 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody3);
    expect(updateRes3.status).toBe(200);

    const secretsDoc3 = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc3.holders.length).toBe(0);
  }, 100000);

  it('should delete secret', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
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
      .send({ ...body, dataIntegrityProof: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretRoute();
    const getResBody: GetSecretRouteRequestBody = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const deleteResRoute = BitBadgesApiRoutes.DeleteSecretRoute();
    const deleteResBody: GetSecretRouteRequestBody = { secretId: getRes.body.secretId };

    const invalidDeleteResAnotherUser = await request(app)
      .post(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(deleteResBody);
    expect(invalidDeleteResAnotherUser.status).toBe(500);

    const deleteRes = await request(app)
      .post(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteResBody);
    expect(deleteRes.status).toBe(200);

    const secretsDoc = await getFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc).toBeFalsy();
  });

  it('should update correctly', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
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
      .send({ ...body, dataIntegrityProof: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretRoute();
    const getResBody: GetSecretRouteRequestBody = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResBody);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const updateSecretRoute = BitBadgesApiRoutes.UpdateSecretRoute();
    const updateSecretBody: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2'
    };

    const updateRes = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc.secretId).toBeDefined();
    expect(secretsDoc.name).toBe('test2');
    expect(secretsDoc.description).toBe('test2');
    expect(secretsDoc.image).toBe('test2');
    expect(secretsDoc.updateHistory.length).toBe(2);

    //reject invalid proofs upon update
    const updateSecretBody2: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2',
      dataIntegrityProof: {
        signature: 'invalid',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const updateRes2 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody2);

    expect(updateRes2.status).toBe(500);

    //Test a valid proof update
    const keyPair2 = await generateBls12381G2KeyPair();
    const dataIntegrityProof2 = await blsSign({
      keyPair: keyPair2!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });

    const newProofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair2?.publicKey ?? '').toString('hex'));
    const newProofOfIssuanceSignature = await ethWallet.signMessage(newProofOfIssuanceMessage);

    const updateSecretBody3: UpdateSecretRouteRequestBody = {
      secretId: getRes.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2',
      dataIntegrityProof: {
        signature: Buffer.from(dataIntegrityProof2).toString('hex'),
        signer: Buffer.from(keyPair2?.publicKey ?? '').toString('hex')
      },
      proofOfIssuance: {
        message: newProofOfIssuanceMessage,
        signature: newProofOfIssuanceSignature,
        signer: ethWallet.address
      }
    };

    const updateRes3 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretBody3);
    console.log(updateRes3.body);
    expect(updateRes3.status).toBe(200);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc2.secretId).toBeDefined();
    expect(secretsDoc2.name).toBe('test2');
    expect(secretsDoc2.description).toBe('test2');
    expect(secretsDoc2.image).toBe('test2');
    expect(secretsDoc2.updateHistory.length).toBe(3);
    expect(secretsDoc2.dataIntegrityProof.signature).toBe(Buffer.from(dataIntegrityProof2).toString('hex'));
  });

  it('should not allow non-owners to update important fields', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const updateSecretRoute = BitBadgesApiRoutes.UpdateSecretRoute();
    const updateSecretBody: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2'
    };

    const updateRes = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretBody);
    expect(updateRes.status).toBeGreaterThan(400);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.name).toBe('test');
    expect(secretsDoc.description).toBe('test');
    expect(secretsDoc.image).toBe('test');

    //No session
    const updateRes2 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretBody);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.name).toBe('test');
    expect(secretsDoc2.description).toBe('test');
    expect(secretsDoc2.image).toBe('test');
  });

  it('should update anchors (owner only)', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const updateSecretRoute = BitBadgesApiRoutes.UpdateSecretRoute();
    const updateSecretBody: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretBody);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.anchors.length).toBe(1);

    const updateSecretBody2: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test2'
        }
      ]
    };

    const updateRes2 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretBody2);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.anchors.length).toBe(1);

    const updateSecretBody3: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes3 = await request(app)
      .post(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretBody3);
    expect(updateRes3.status).toBeGreaterThan(400);
  });

  it('can add holders to secret (self add only)', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'bbs',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair?.publicKey ?? '').toString('hex'));
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature,
      signer: ethWallet.address
    };

    const dataIntegrityProof = await blsSign({
      keyPair: keyPair!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });
    body.dataIntegrityProof = {
      signature: Buffer.from(dataIntegrityProof).toString('hex'),
      signer: Buffer.from(keyPair?.publicKey ?? '').toString('hex')
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const updateSecretRoute = BitBadgesApiRoutes.UpdateSecretRoute;
    const updateSecretBody: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: false
        }
      ]
    };

    const updateRes = await request(app)
      .post(updateSecretRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretBody);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.holders.length).toBe(1);

    const updateSecretBody2: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethers.Wallet.createRandom().address),
          delete: false
        }
      ]
    };

    const updateRes2 = await request(app)
      .post(updateSecretRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretBody2);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.holders.length).toBe(1);

    const updateSecretBody3: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: true
        }
      ]
    };

    const updateRes3 = await request(app)
      .post(updateSecretRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretBody3);
    expect(updateRes3.status).toBeGreaterThan(400);

    const secretsDoc3 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc3.holders.length).toBe(1);

    //Test deletes
    const updateSecretBody4: UpdateSecretRouteRequestBody = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: true
        }
      ]
    };

    const updateRes4 = await request(app)
      .post(updateSecretRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretBody4);
    expect(updateRes4.status).toBe(200);

    const secretsDoc4 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc4.holders.length).toBe(0);
  }, 20000);

  it('should verify standard sig proofs (non BBS)', async () => {
    const route = BitBadgesApiRoutes.CreateSecretRoute();
    const body: CreateSecretRouteRequestBody = {
      name: 'test',
      description: 'test',
      image: 'test',
      secretMessages: ['test'],
      type: 'credential',
      scheme: 'standard',
      messageFormat: 'plaintext',
      proofOfIssuance: {
        message: '',
        signature: '',
        signer: ''
      },
      dataIntegrityProof: {
        signature: '',
        signer: ''
      }
    };

    const ethWallet = ethers.Wallet.createRandom();
    const address = ethWallet.address;
    const proofOfIssuanceMessage = 'proof of issuance is not needed';
    const proofOfIssuanceSignature = await ethWallet.signMessage(proofOfIssuanceMessage);
    body.proofOfIssuance = {
      signer: ethWallet.address,
      message: proofOfIssuanceMessage,
      signature: proofOfIssuanceSignature
    };

    body.dataIntegrityProof = {
      signature: await ethWallet.signMessage(body.secretMessages[0]),
      signer: ethWallet.address
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);
  });
});
