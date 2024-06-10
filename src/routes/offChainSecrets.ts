import {
  UpdateHistory,
  verifyAttestationsPresentationSignatures,
  type CreateAttestationPayload,
  type DeleteAttestationPayload,
  type ErrorResponse,
  type GetAttestationPayload,
  type NumberType,
  type UpdateAttestationPayload,
  type iCreateAttestationSuccessResponse,
  type iDeleteAttestationSuccessResponse,
  type iGetAttestationSuccessResponse,
  type iUpdateAttestationSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { AuthenticatedRequest, mustGetAuthDetails } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { OffChainAttestationsModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';
import typia from 'typia';
import { typiaError } from './search';

export const createAttestation = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateAttestationSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as CreateAttestationPayload;
    const validateRes: typia.IValidation<CreateAttestationPayload> = typia.validate<CreateAttestationPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const authDetails = await mustGetAuthDetails(req, res);
    await verifyAttestationsPresentationSignatures({
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

    await insertToDB(OffChainAttestationsModel, {
      createdBy: authDetails.cosmosAddress,
      attestationId: uniqueId,
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

    return res.status(200).send({ attestationId: uniqueId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error creating attestation.'
    });
  }
};

export const getAttestation = async (req: Request, res: Response<iGetAttestationSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetAttestationPayload;
    const validateRes: typia.IValidation<GetAttestationPayload> = typia.validate<GetAttestationPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }
    const doc = await mustGetFromDB(OffChainAttestationsModel, reqPayload.attestationId);
    return res.status(200).send(doc);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting attestation.'
    });
  }
};

export const deleteAttestation = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteAttestationSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as DeleteAttestationPayload;
    const validateRes: typia.IValidation<DeleteAttestationPayload> = typia.validate<DeleteAttestationPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const authDetails = await mustGetAuthDetails(req, res);
    const doc = await mustGetFromDB(OffChainAttestationsModel, reqPayload.attestationId);
    if (doc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this Siwbb request.');
    }

    await deleteMany(OffChainAttestationsModel, [reqPayload.attestationId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error deleting attestation.'
    });
  }
};

export const updateAttestation = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateAttestationSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as UpdateAttestationPayload;
    const validateRes: typia.IValidation<UpdateAttestationPayload> = typia.validate<UpdateAttestationPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const authDetails = await mustGetAuthDetails(req, res);
    let doc = await mustGetFromDB(OffChainAttestationsModel, reqPayload.attestationId);

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
      await OffChainAttestationsModel.findOneAndUpdate({ _docId: reqPayload.attestationId }, setter).lean().exec();
    }

    doc = await mustGetFromDB(OffChainAttestationsModel, reqPayload.attestationId);

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
      'attestationMessages',
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
    doc.attestationMessages = reqPayload.attestationMessages ?? doc.attestationMessages;
    doc.dataIntegrityProof = reqPayload.dataIntegrityProof ?? doc.dataIntegrityProof;
    doc.name = reqPayload.name ?? doc.name;
    doc.image = reqPayload.image ?? doc.image;
    doc.description = reqPayload.description ?? doc.description;

    await verifyAttestationsPresentationSignatures(doc);

    const status = await getStatus();
    doc.updateHistory.push(
      new UpdateHistory({
        txHash: '',
        block: status.block.height,
        blockTimestamp: status.block.timestamp,
        timestamp: BigInt(Date.now())
      })
    );

    await insertToDB(OffChainAttestationsModel, doc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error updating attestation.'
    });
  }
};
