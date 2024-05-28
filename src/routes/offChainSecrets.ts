import {
  UpdateHistory,
  verifySecretsPresentationSignatures,
  type CreateSecretPayload,
  type DeleteSecretPayload,
  type ErrorResponse,
  type GetSecretPayload,
  type NumberType,
  type UpdateSecretPayload,
  type iCreateSecretSuccessResponse,
  type iDeleteSecretSuccessResponse,
  type iGetSecretSuccessResponse,
  type iUpdateSecretSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { AuthenticatedRequest, mustGetAuthDetails } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { OffChainSecretsModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

export const createSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateSecretSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as CreateSecretPayload;
    const authDetails = await mustGetAuthDetails(req, res);
    await verifySecretsPresentationSignatures({
      ...reqPayload,
      createdBy: authDetails.cosmosAddress
    });

    const uniqueId = crypto.randomBytes(32).toString('hex');

    const status = await getStatus();
    let image = reqPayload.image;

    if (reqPayload.image.startsWith('data:')) {
      const results = await addMetadataToIpfs([
        {
          name: reqPayload.name,
          description: reqPayload.description,
          image: reqPayload.image
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
      createdBy: authDetails.cosmosAddress,
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
      ...reqPayload,
      image
    });

    return res.status(200).send({ secretId: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error creating secret.'
    });
  }
};

export const getSecret = async (req: Request, res: Response<iGetSecretSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetSecretPayload;

    const doc = await mustGetFromDB(OffChainSecretsModel, reqPayload.secretId);
    return res.status(200).send(doc);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting secret.'
    });
  }
};

export const deleteSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteSecretSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as DeleteSecretPayload;
    const authDetails = await mustGetAuthDetails(req, res);
    const doc = await mustGetFromDB(OffChainSecretsModel, reqPayload.secretId);
    if (doc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this Siwbb request.');
    }

    await deleteMany(OffChainSecretsModel, [reqPayload.secretId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error deleting secret.'
    });
  }
};

export const updateSecret = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateSecretSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as UpdateSecretPayload;
    const authDetails = await mustGetAuthDetails(req, res);
    let doc = await mustGetFromDB(OffChainSecretsModel, reqPayload.secretId);

    for (const viewerToAdd of reqPayload.holdersToSet ?? []) {
      const cosmosAddress = viewerToAdd.cosmosAddress;
      if (authDetails.cosmosAddress !== doc.createdBy && authDetails.cosmosAddress !== cosmosAddress) {
        throw new Error('To update a viewer, you must be the owner or add yourself as a viewer.');
      }
    }

    const holdersToAdd = reqPayload.holdersToSet?.filter((v) => !v.delete).map((v) => v.cosmosAddress) ?? [];
    const holdersToRemove = reqPayload.holdersToSet?.filter((v) => v.delete).map((v) => v.cosmosAddress) ?? [];

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
      await OffChainSecretsModel.findOneAndUpdate({ _docId: reqPayload.secretId }, setter).lean().exec();
    }

    doc = await mustGetFromDB(OffChainSecretsModel, reqPayload.secretId);

    if (
      reqPayload.anchorsToAdd &&
      reqPayload.anchorsToAdd.length > 0 &&
      authDetails.cosmosAddress !== doc.createdBy &&
      !doc.holders.includes(authDetails.cosmosAddress)
    ) {
      throw new Error('Only the owner can update anchors');
    }

    doc.anchors = [...doc.anchors, ...(reqPayload.anchorsToAdd ?? [])];

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
    if (authDetails.cosmosAddress !== doc.createdBy && Object.keys(reqPayload).some((k) => keysToUpdate.includes(k))) {
      throw new Error('You are not the owner, so you cannot update its core details.');
    }

    doc.proofOfIssuance = reqPayload.proofOfIssuance ?? doc.proofOfIssuance;
    doc.scheme = reqPayload.scheme ?? doc.scheme;
    doc.messageFormat = reqPayload.messageFormat ?? doc.messageFormat;
    doc.type = reqPayload.type ?? doc.type;
    doc.secretMessages = reqPayload.secretMessages ?? doc.secretMessages;
    doc.dataIntegrityProof = reqPayload.dataIntegrityProof ?? doc.dataIntegrityProof;
    doc.name = reqPayload.name ?? doc.name;
    doc.image = reqPayload.image ?? doc.image;
    doc.description = reqPayload.description ?? doc.description;

    await verifySecretsPresentationSignatures(doc);

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
      errorMessage: e.message || 'Error updating secret.'
    });
  }
};
