import { blsVerify, blsVerifyProof } from '@mattrglobal/bbs-signatures';
import {
  DeleteSecretRouteRequestBody,
  GetSecretRouteRequestBody,
  UpdateHistory,
  UpdateSecretRouteRequestBody,
  getChainForAddress,
  iDeleteSecretRouteSuccessResponse,
  iGetSecretRouteSuccessResponse,
  iSecretsProof,
  iUpdateSecretRouteSuccessResponse,
  type CreateSecretRouteRequestBody,
  type ErrorResponse,
  type NumberType,
  type iCreateSecretRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { getChainDriver } from '../blockin/blockin';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { OffChainSecretsModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

export const verifySecretsProof = async (
  address: string,
  body: Omit<iSecretsProof<NumberType>, 'createdBy' | 'anchors' | 'viewers' | 'updateHistory' | 'credential' | 'entropies'>,
  derivedProof?: boolean
) => {
  const chain = getChainForAddress(address);

  if (!body.secretMessages.length || body.secretMessages.some((m) => !m)) {
    throw new Error('Messages are required and cannot be empty');
  }

  if (body.messageFormat === 'json') {
    for (const message of body.secretMessages) {
      try {
        JSON.parse(message);
      } catch (e) {
        throw new Error('Message is not valid JSON');
      }
    }
  }

  //Check data integrity proof
  if (body.dataIntegrityProof) {
    if (body.scheme === 'standard') {
      await getChainDriver(chain).verifySignature(
        address,
        body.secretMessages[0],
        body.dataIntegrityProof.signature,
        body.dataIntegrityProof.publicKey
      );
    } else if (body.scheme == 'bbs') {
      if (!body.proofOfIssuance || !body.proofOfIssuance.message || !body.proofOfIssuance.signature) {
        throw new Error('Proof of issuance is required for BBS scheme');
      }

      await getChainDriver(chain).verifySignature(
        address,
        body.proofOfIssuance.message,
        body.proofOfIssuance.signature,
        body.proofOfIssuance.publicKey
      );

      if (!derivedProof) {
        const isProofVerified = await blsVerify({
          signature: Uint8Array.from(Buffer.from(body.dataIntegrityProof.signature, 'hex')),
          publicKey: Uint8Array.from(Buffer.from(body.dataIntegrityProof.signer, 'hex')),
          messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8')))
        });

        if (!isProofVerified.verified) {
          throw new Error('Data integrity proof not verified');
        }
      } else {
        const isProofVerified = await blsVerifyProof({
          proof: Uint8Array.from(Buffer.from(body.dataIntegrityProof.signature, 'hex')),
          publicKey: Uint8Array.from(Buffer.from(body.dataIntegrityProof.signer, 'hex')),
          messages: body.secretMessages.map((message) => Uint8Array.from(Buffer.from(message, 'utf-8'))),
          nonce: Uint8Array.from(Buffer.from('nonce', 'utf8'))
        });

        if (!isProofVerified.verified) {
          throw new Error('Data integrity proof not verified');
        }
      }
    } else {
      throw new Error('Invalid scheme');
    }
  } else {
    throw new Error('Data integrity proof is required');
  }
};

export const createSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateSecretRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as CreateSecretRouteRequestBody;

    await verifySecretsProof(req.session.address, reqBody);

    const uniqueId = crypto.randomBytes(32).toString('hex');

    const status = await getStatus();
    let image = reqBody.image;

    if (reqBody.image.startsWith('data:')) {
      const { collectionMetadataResult } = await addMetadataToIpfs({
        name: reqBody.name,
        description: reqBody.description,
        image: reqBody.image
      });
      if (!collectionMetadataResult) {
        throw new Error('Error adding metadata to IPFS');
      }

      const res = await getFromIpfs(collectionMetadataResult.cid);
      const metadata = JSON.parse(res.file.toString());

      image = metadata.image;
    }

    await insertToDB(OffChainSecretsModel, {
      createdBy: req.session.cosmosAddress,
      secretId: uniqueId,
      _docId: uniqueId,
      viewers: [],
      anchors: [],
      updateHistory: [
        {
          txHash: '',
          block: status.block.height,
          blockTimestamp: status.block.timestamp,
          timestamp: Date.now()
        }
      ],
      ...reqBody,
      image
    });

    return res.status(200).send({ secretId: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating QR auth code.'
    });
  }
};

export const getSecret = async (req: Request, res: Response<iGetSecretRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetSecretRouteRequestBody;

    const doc = await mustGetFromDB(OffChainSecretsModel, reqBody.secretId);
    return res.status(200).send(doc);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting auth QR code.'
    });
  }
};

export const deleteSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteSecretRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as DeleteSecretRouteRequestBody;

    const doc = await mustGetFromDB(OffChainSecretsModel, reqBody.secretId);
    if (doc.createdBy !== req.session.cosmosAddress) {
      throw new Error('You are not the owner of this auth code.');
    }

    //TODO: Do deletedAt like auth codes?

    await deleteMany(OffChainSecretsModel, [reqBody.secretId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting QR auth code.'
    });
  }
};

export const updateSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateSecretRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as UpdateSecretRouteRequestBody;

    const doc = await mustGetFromDB(OffChainSecretsModel, reqBody.secretId);

    for (const viewerToAdd of reqBody.viewersToSet ?? []) {
      const toAdd = !viewerToAdd.delete;
      const cosmosAddress = viewerToAdd.cosmosAddress;
      if (req.session.cosmosAddress !== doc.createdBy && req.session.cosmosAddress !== cosmosAddress) {
        throw new Error('To update a viewer, you must be the owner or add yourself as a viewer.');
      }

      if (toAdd) {
        if (doc.viewers.includes(cosmosAddress)) {
          throw new Error('Viewer already exists');
        }
        doc.viewers.push(cosmosAddress);
      } else {
        if (!doc.viewers.includes(cosmosAddress)) {
          throw new Error('Viewer does not exist');
        }
        doc.viewers = doc.viewers.filter((v) => v !== cosmosAddress);
      }
    }

    if (
      reqBody.anchorsToAdd &&
      reqBody.anchorsToAdd.length > 0 &&
      req.session.cosmosAddress !== doc.createdBy &&
      !doc.viewers.includes(req.session.cosmosAddress)
    ) {
      throw new Error('Only the owner can update anchors');
    }

    doc.anchors = [...doc.anchors, ...(reqBody.anchorsToAdd ?? [])];

    const keysToUpdate = [
      'proofOfIssuance',
      'scheme',
      'type',
      'secretMessages',
      'dataIntegrityProof',
      'name',
      'image',
      'description',
      'messageFormat'
    ];
    if (req.session.cosmosAddress !== doc.createdBy && Object.keys(reqBody).some((k) => keysToUpdate.includes(k))) {
      throw new Error('You are not the owner of this auth code, so you cannot update its core details.');
    }

    doc.proofOfIssuance = reqBody.proofOfIssuance ?? doc.proofOfIssuance;
    doc.scheme = reqBody.scheme ?? doc.scheme;
    doc.messageFormat = reqBody.messageFormat ?? doc.messageFormat;
    doc.type = reqBody.type ?? doc.type;
    doc.secretMessages = reqBody.secretMessages ?? doc.secretMessages;
    doc.dataIntegrityProof = reqBody.dataIntegrityProof ?? doc.dataIntegrityProof;
    doc.name = reqBody.name ?? doc.name;
    doc.image = reqBody.image ?? doc.image;
    doc.description = reqBody.description ?? doc.description;

    await verifySecretsProof(req.session.address, doc);

    const status = await getStatus();
    doc.updateHistory.push(
      new UpdateHistory({
        txHash: '',
        block: status.block.height,
        blockTimestamp: status.block.timestamp,
        timestamp: BigInt(Date.now())
      })
    );

    await insertToDB(OffChainSecretsModel, doc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error updating QR auth code.'
    });
  }
};
