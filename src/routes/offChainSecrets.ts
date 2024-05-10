import {
  UpdateHistory,
  verifySecretsProofSignatures,
  type CreateSecretRouteRequestBody,
  type DeleteSecretRouteRequestBody,
  type ErrorResponse,
  type GetSecretRouteRequestBody,
  type NumberType,
  type UpdateSecretRouteRequestBody,
  type iCreateSecretRouteSuccessResponse,
  type iDeleteSecretRouteSuccessResponse,
  type iGetSecretRouteSuccessResponse,
  type iUpdateSecretRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { OffChainSecretsModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

export const createSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateSecretRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as CreateSecretRouteRequestBody;

    await verifySecretsProofSignatures({
      ...reqBody,
      createdBy: req.session.cosmosAddress
    });

    const uniqueId = crypto.randomBytes(32).toString('hex');

    const status = await getStatus();
    let image = reqBody.image;

    if (reqBody.image.startsWith('data:')) {
      const { results } = await addMetadataToIpfs([
        {
          name: reqBody.name,
          description: reqBody.description,
          image: reqBody.image
        }
      ]);
      if (!results?.[0]) {
        throw new Error('Error adding metadata to IPFS');
      }

      const result = results[0];
      const res = await getFromIpfs(result.cid);
      const metadata = JSON.parse(res.file.toString());

      image = metadata.image;
    }

    await insertToDB(OffChainSecretsModel, {
      createdBy: req.session.cosmosAddress,
      secretId: uniqueId,
      _docId: uniqueId,
      holders: [],
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

    let doc = await mustGetFromDB(OffChainSecretsModel, reqBody.secretId);

    for (const viewerToAdd of reqBody.holdersToSet ?? []) {
      const cosmosAddress = viewerToAdd.cosmosAddress;
      if (req.session.cosmosAddress !== doc.createdBy && req.session.cosmosAddress !== cosmosAddress) {
        throw new Error('To update a viewer, you must be the owner or add yourself as a viewer.');
      }
    }

    const holdersToAdd = reqBody.holdersToSet?.filter((v) => !v.delete).map((v) => v.cosmosAddress) ?? [];
    const holdersToRemove = reqBody.holdersToSet?.filter((v) => v.delete).map((v) => v.cosmosAddress) ?? [];

    //TODO: session?
    const setters = [];
    if (holdersToAdd.length > 0) {
      setters.push({
        $push: {
          holders: { $each: holdersToAdd }
        }
      });
    }
    if (holdersToRemove.length > 0) {
      setters.push({
        $pull: {
          holders: { $in: holdersToRemove }
        }
      });
    }

    for (const setter of setters) {
      await OffChainSecretsModel.findOneAndUpdate({ _docId: reqBody.secretId }, setter).lean().exec();
    }

    doc = await mustGetFromDB(OffChainSecretsModel, reqBody.secretId);

    if (
      reqBody.anchorsToAdd &&
      reqBody.anchorsToAdd.length > 0 &&
      req.session.cosmosAddress !== doc.createdBy &&
      !doc.holders.includes(req.session.cosmosAddress)
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
      throw new Error('You are not the owner, so you cannot update its core details.');
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

    await verifySecretsProofSignatures(doc);

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
