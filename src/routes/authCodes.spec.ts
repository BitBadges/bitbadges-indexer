import { blsCreateProof, blsSign, generateBls12381G2KeyPair } from '@mattrglobal/bbs-signatures';
import {
  BitBadgesApiRoutes,
  CreateSecretPayload,
  GetSecretPayload,
  UpdateSecretPayload,
  convertToCosmosAddress,
  verifySecretsPresentationSignatures,
  type CreateSIWBBRequestPayload,
  type DeleteSIWBBRequestPayload,
  type GetAndVerifySIWBBRequestPayload,
  CreateDeveloperAppPayload
} from 'bitbadgesjs-sdk';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Express } from 'express';
import request from 'supertest';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { DeveloperAppModel, OffChainSecretsModel, SIWBBRequestModel } from '../db/schemas';
import { createExampleReqForAddress } from '../testutil/utils';
const app = (global as any).app as Express;

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

describe('get Siwbb requests', () => {
  beforeAll(async () => {
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

    signature = await wallet.signMessage(message ?? '');
  });

  it('should not create Siwbb request in storage without correct scope', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
      clientId,
      message,
      signature,
      name: 'test',
      image: '',
      description: '',
      secretsPresentations: [
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

  it('should create Siwbb request in storage', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
      clientId,
      message,
      signature,
      name: 'test',
      image: '',
      description: ''
    };

    const invalidClientIdRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ ...body, clientId: 'invalid' });
    expect(invalidClientIdRes.status).toBeGreaterThanOrEqual(400);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const siwbbRequestId = res.body.code;
    console.log(res.body);

    const invalidSigRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ ...body, signature: 'invalid' });
    expect(invalidSigRes.status).toBe(500);

    const getResRoute = BitBadgesApiRoutes.GetAndVerifySIWBBRequestsRoute();
    const getResPayload: GetAndVerifySIWBBRequestPayload = { code: siwbbRequestId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResPayload);
    console.log(getRes);
    expect(getRes.status).toBe(200);
    expect(getRes.body.blockin.message).toBeDefined();

    const invalidGetRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ code: 'invalid' });
    expect(invalidGetRes.status).toBe(500);

    const unauthorizedDeleteRes = await request(app)
      .delete(BitBadgesApiRoutes.CRUDSIWBBRequestRoute())
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ code: siwbbRequestId });
    expect(unauthorizedDeleteRes.status).toBe(401);

    const deleteResRoute = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const deleteResPayload: DeleteSIWBBRequestPayload = { code: siwbbRequestId };
    const deleteRes = await request(app)
      .delete(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteResPayload);
    expect(deleteRes.status).toBe(200);
  });

  it('should not allow deleting an unowned Siwbb request', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
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

    const siwbbRequestId = res.body.code;

    const deleteResRoute = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const deleteResPayload: DeleteSIWBBRequestPayload = { code: siwbbRequestId };
    const deleteRes = await request(app)
      .delete(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set(
        'x-mock-session',
        JSON.stringify({
          ...createExampleReqForAddress(address).session,
          cosmosAddress: 'cosmos1uqxan5ch2ulhkjrgmre90rr923932w38tn33gu'
        })
      )
      .send(deleteResPayload);
    expect(deleteRes.status).toBe(500);
  });

  it('should check signature before creating Siwbb request', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
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
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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
      .send({
        ...body,
        dataIntegrityProof: {
          signature: '',
          signer: '',
          message: 'invalid'
        }
      });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretsRoute();
    const getResPayload: GetSecretPayload = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResPayload);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const CRUDSIWBBRequestRoute = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const createSIWBBRequestPayload: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
      clientId,
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

    createSIWBBRequestPayload.secretsPresentations = [
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

    await verifySecretsPresentationSignatures(createSIWBBRequestPayload.secretsPresentations[0], true);

    const siwbbRequestRes = await request(app)
      .post(CRUDSIWBBRequestRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(createSIWBBRequestPayload);
    console.log(siwbbRequestRes.body);
    expect(siwbbRequestRes.status).toBe(200);

    const getAndVerifySIWBBRequestResRoute = BitBadgesApiRoutes.GetAndVerifySIWBBRequestsRoute();
    const getAndVerifySIWBBRequestResPayload: GetAndVerifySIWBBRequestPayload = { code: siwbbRequestRes.body.code };
    const getAndVerifySIWBBRequestRes = await request(app)
      .post(getAndVerifySIWBBRequestResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getAndVerifySIWBBRequestResPayload);
    expect(getAndVerifySIWBBRequestRes.status).toBe(200);
    expect(getAndVerifySIWBBRequestRes.body.blockin.message).toBeDefined();
    expect(getAndVerifySIWBBRequestRes.body.blockin.secretsPresentations).toBeDefined();
    expect(getAndVerifySIWBBRequestRes.body.blockin.secretsPresentations.length).toBe(1);
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
      verifySecretsPresentationSignatures({
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
      verifySecretsPresentationSignatures({
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
      verifySecretsPresentationSignatures(
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
      verifySecretsPresentationSignatures(
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
      verifySecretsPresentationSignatures(
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
      verifySecretsPresentationSignatures(
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
      verifySecretsPresentationSignatures(
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
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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
      .send({
        ...body,
        dataIntegrityProof: {
          signature: '',
          signer: '',
          message: 'invalid'
        }
      });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretsRoute();
    const getResPayload: GetSecretPayload = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResPayload);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const updateSecretRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const updateSecretPayload: UpdateSecretPayload = {
      secretId: getRes.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc.anchors.length).toBe(1);
    expect(secretsDoc.anchors[0].txHash).toBe('test');

    const updateSecretPayload2: UpdateSecretPayload = {
      secretId: getRes.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(address),
          delete: false
        }
      ]
    };

    const updateRes2 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload2);
    expect(updateRes2.status).toBe(200);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc2.holders.length).toBe(1);

    const updateSecretPayload3: UpdateSecretPayload = {
      secretId: getRes.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(address),
          delete: true
        }
      ]
    };

    const updateRes3 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload3);
    expect(updateRes3.status).toBe(200);

    const secretsDoc3 = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc3.holders.length).toBe(0);
  }, 100000);

  it('should delete secret', async () => {
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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
      .send({
        ...body,
        dataIntegrityProof: {
          signature: '',
          signer: '',
          message: 'invalid'
        }
      });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretsRoute();
    const getResPayload: GetSecretPayload = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResPayload);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const deleteResRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const deleteResPayload: GetSecretPayload = { secretId: getRes.body.secretId };

    const invalidDeleteResAnotherUser = await request(app)
      .delete(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(deleteResPayload);
    expect(invalidDeleteResAnotherUser.status).toBe(500);

    const deleteRes = await request(app)
      .delete(deleteResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(deleteResPayload);
    expect(deleteRes.status).toBe(200);

    const secretsDoc = await getFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc).toBeFalsy();
  });

  it('should update correctly', async () => {
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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
      .send({
        ...body,
        dataIntegrityProof: {
          signature: '',
          signer: '',
          message: 'invalid'
        }
      });
    expect(invalidSigRes.status).toBe(500);

    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetSecretsRoute();
    const getResPayload: GetSecretPayload = { secretId: res.body.secretId };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(getResPayload);
    expect(getRes.status).toBe(200);
    expect(getRes.body.secretId).toBeDefined();

    const updateSecretRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const updateSecretPayload: UpdateSecretPayload = {
      secretId: getRes.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2'
    };

    const updateRes = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, getRes.body.secretId);
    expect(secretsDoc.secretId).toBeDefined();
    expect(secretsDoc.name).toBe('test2');
    expect(secretsDoc.description).toBe('test2');
    expect(secretsDoc.image).toBe('test2');
    expect(secretsDoc.updateHistory.length).toBe(2);

    //reject invalid proofs upon update
    const updateSecretPayload2: UpdateSecretPayload = {
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
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload2);

    expect(updateRes2.status).toBe(500);

    //Test a valid proof update
    const keyPair2 = await generateBls12381G2KeyPair();
    const dataIntegrityProof2 = await blsSign({
      keyPair: keyPair2!,
      messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
    });

    const newProofOfIssuanceMessage = proofOfIssuancePlaceholder.replace('INSERT_HERE', Buffer.from(keyPair2?.publicKey ?? '').toString('hex'));
    const newProofOfIssuanceSignature = await ethWallet.signMessage(newProofOfIssuanceMessage);

    const updateSecretPayload3: UpdateSecretPayload = {
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
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(updateSecretPayload3);
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
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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

    const updateSecretRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const updateSecretPayload: UpdateSecretPayload = {
      secretId: res.body.secretId,
      name: 'test2',
      description: 'test2',
      image: 'test2'
    };

    const updateRes = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretPayload);
    expect(updateRes.status).toBeGreaterThan(400);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.name).toBe('test');
    expect(secretsDoc.description).toBe('test');
    expect(secretsDoc.image).toBe('test');

    //No session
    const updateRes2 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretPayload);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.name).toBe('test');
    expect(secretsDoc2.description).toBe('test');
    expect(secretsDoc2.image).toBe('test');
  });

  it('should update anchors (owner only)', async () => {
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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

    const updateSecretRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const updateSecretPayload: UpdateSecretPayload = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretPayload);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.anchors.length).toBe(1);

    const updateSecretPayload2: UpdateSecretPayload = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test2'
        }
      ]
    };

    const updateRes2 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretPayload2);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.anchors.length).toBe(1);

    const updateSecretPayload3: UpdateSecretPayload = {
      secretId: res.body.secretId,
      anchorsToAdd: [
        {
          txHash: 'test'
        }
      ]
    };

    const updateRes3 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretPayload3);
    expect(updateRes3.status).toBeGreaterThan(400);
  });

  it('can add holders to secret (self add only)', async () => {
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const keyPair = await generateBls12381G2KeyPair();
    const body: CreateSecretPayload = {
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

    const updateSecretRoute = BitBadgesApiRoutes.CRUDSecretRoute();
    const updateSecretPayload: UpdateSecretPayload = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: false
        }
      ]
    };

    const updateRes = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretPayload);
    expect(updateRes.status).toBe(200);

    const secretsDoc = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc.holders.length).toBe(1);

    const updateSecretPayload2: UpdateSecretPayload = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethers.Wallet.createRandom().address),
          delete: false
        }
      ]
    };

    const updateRes2 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethers.Wallet.createRandom().address).session))
      .send(updateSecretPayload2);
    expect(updateRes2.status).toBeGreaterThan(400);

    const secretsDoc2 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc2.holders.length).toBe(1);

    const updateSecretPayload3: UpdateSecretPayload = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: true
        }
      ]
    };

    const updateRes3 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(updateSecretPayload3);
    expect(updateRes3.status).toBeGreaterThan(400);

    const secretsDoc3 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc3.holders.length).toBe(1);

    //Test deletes
    const updateSecretPayload4: UpdateSecretPayload = {
      secretId: res.body.secretId,
      holdersToSet: [
        {
          cosmosAddress: convertToCosmosAddress(ethWallet.address),
          delete: true
        }
      ]
    };

    const updateRes4 = await request(app)
      .put(updateSecretRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(ethWallet.address).session))
      .send(updateSecretPayload4);
    expect(updateRes4.status).toBe(200);

    const secretsDoc4 = await mustGetFromDB(OffChainSecretsModel, res.body.secretId);
    expect(secretsDoc4.holders.length).toBe(0);
  }, 20000);

  it('should verify standard sig proofs (non BBS)', async () => {
    const route = BitBadgesApiRoutes.CRUDSecretRoute();
    const body: CreateSecretPayload = {
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

  it('should be able to get client ID with proof of clientSecret', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const clientSecret = clientIdDocs[0].clientSecret;
    const redirectUri = clientIdDocs[0].redirectUris[0];
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
      clientId,
      message,
      signature,
      name: 'test',
      image: '',
      description: '',
      redirectUri: ''
    };

    const invalidRedirectUriRes = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send({ ...body, redirectUri: 'https://bitbadges.io/somethingrandom' });
    expect(invalidRedirectUriRes.status).toBeGreaterThanOrEqual(400);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const doc = await mustGetFromDB(SIWBBRequestModel, res.body.code);
    await insertToDB(SIWBBRequestModel, { ...doc, redirectUri });

    const siwbbRequestId = res.body.code;
    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetAndVerifySIWBBRequestsRoute();
    const getResPayload: GetAndVerifySIWBBRequestPayload = { code: siwbbRequestId, clientId, clientSecret, redirectUri };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getResPayload);
    console.log(getRes.body);

    expect(getRes.status).toBe(200);
    expect(getRes.body.blockin).toBeDefined();
    expect(getRes.body.blockin.otherSignIns?.discord).toBeUndefined();

    const invalidClientIdPresentedRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ ...getResPayload, clientId: 'invalid' });

    expect(invalidClientIdPresentedRes.status).toBeGreaterThanOrEqual(400);

    const invalidClientSecretPresentedRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ ...getResPayload, clientSecret: 'invalid' });

    expect(invalidClientSecretPresentedRes.status).toBeGreaterThanOrEqual(400);

    const invalidRedirectUriPresentedRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send({ ...getResPayload, redirectUri: 'invalid' });
    expect(invalidRedirectUriPresentedRes.status).toBeGreaterThanOrEqual(400);
  });

  it('should work with other sign ins', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const clientSecret = clientIdDocs[0].clientSecret;
    const redirectUri = clientIdDocs[0].redirectUris[0];
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: false,
      clientId,
      message,
      signature,
      name: 'test',
      image: '',
      description: '',
      redirectUri: '',
      otherSignIns: ['discord', 'github']
    };

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const doc = await mustGetFromDB(SIWBBRequestModel, res.body.code);
    await insertToDB(SIWBBRequestModel, { ...doc, redirectUri });

    const siwbbRequestId = res.body.code;
    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetAndVerifySIWBBRequestsRoute();
    const getResPayload: GetAndVerifySIWBBRequestPayload = { code: siwbbRequestId, clientId, clientSecret, redirectUri };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getResPayload);
    console.log(getRes.body);

    expect(getRes.status).toBe(200);
    expect(getRes.body.blockin).toBeDefined();
    expect(getRes.body.blockin.otherSignIns?.discord?.username).toBe('testuser');
    expect(getRes.body.blockin.otherSignIns?.github?.username).toBe('testuser');
    expect(getRes.body.blockin.otherSignIns?.google?.username).toBeUndefined();
  });

  it('should allow for reuse of BitBadges sign in', async () => {
    const route = BitBadgesApiRoutes.CRUDSIWBBRequestRoute();
    const clientIdDocs = await findInDB(DeveloperAppModel, { query: { _docId: { $exists: true } } });
    const clientId = clientIdDocs[0]._docId;
    const clientSecret = clientIdDocs[0].clientSecret;
    const redirectUri = clientIdDocs[0].redirectUris[0];
    const body: CreateSIWBBRequestPayload = {
      allowReuseOfBitBadgesSignIn: true,
      clientId,
      message,
      signature: '',
      name: 'test',
      image: '',
      description: '',
      redirectUri: ''
    };

    const invalidResWithoutAuth = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(body);
    expect(invalidResWithoutAuth.status).toBeGreaterThanOrEqual(400);

    const res = await request(app)
      .post(route)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .set('x-mock-session', JSON.stringify(createExampleReqForAddress(address).session))
      .send(body);
    expect(res.status).toBe(200);

    const doc = await mustGetFromDB(SIWBBRequestModel, res.body.code);
    await insertToDB(SIWBBRequestModel, { ...doc, redirectUri });

    const siwbbRequestId = res.body.code;
    console.log(res.body);

    const getResRoute = BitBadgesApiRoutes.GetAndVerifySIWBBRequestsRoute();
    const getResPayload: GetAndVerifySIWBBRequestPayload = { code: siwbbRequestId, clientId, clientSecret, redirectUri };
    const getRes = await request(app)
      .post(getResRoute)
      .set('x-api-key', process.env.BITBADGES_API_KEY ?? '')
      .send(getResPayload);
    console.log(getRes.body);

    expect(getRes.status).toBe(200);
    expect(getRes.body.blockin).toBeDefined();
    expect(getRes.body.blockin.otherSignIns?.discord).toBeUndefined();
  });
});
