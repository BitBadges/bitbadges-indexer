import {
  type CreateAuthAppRouteRequestBody,
  type DeleteAuthAppRouteRequestBody,
  type ErrorResponse,
  type NumberType,
  type UpdateAuthAppRouteRequestBody,
  type iCreateAuthAppRouteSuccessResponse,
  type iDeleteAuthAppRouteSuccessResponse,
  type iGetAuthAppRouteSuccessResponse,
  type iUpdateAuthAppRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { findInDB } from '../db/queries';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { AuthAppModel } from '../db/schemas';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

const getImage = async (image: string) => {
  if (image.startsWith('data:')) {
    const { results } = await addMetadataToIpfs([
      {
        name: '',
        description: '',
        image: image
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

  return image;
};

export const createAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateAuthAppRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as CreateAuthAppRouteRequestBody;

    const uniqueClientId = crypto.randomBytes(32).toString('hex');
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');

    const image = await getImage(reqBody.image);

    await insertToDB(AuthAppModel, {
      createdBy: req.session.cosmosAddress,
      _docId: uniqueClientId,
      clientId: uniqueClientId,
      clientSecret: uniqueClientSecret,
      name: reqBody.name,
      image,
      description: reqBody.description,
      redirectUris: reqBody.redirectUris
    });

    return res.status(200).send({ clientId: uniqueClientId, clientSecret: uniqueClientSecret });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating QR auth code.'
    });
  }
};

export const getAuthApps = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetAuthAppRouteSuccessResponse | ErrorResponse>) => {
  try {
    const docs = await findInDB(AuthAppModel, {
      query: {
        createdBy: req.session.cosmosAddress
      }
    });

    return res.status(200).send({ authApps: docs });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting auth QR code.'
    });
  }
};

export const deleteAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteAuthAppRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as DeleteAuthAppRouteRequestBody;

    const doc = await mustGetFromDB(AuthAppModel, reqBody.clientId);
    if (doc.createdBy !== req.session.cosmosAddress) {
      throw new Error('You are not the owner of this auth code.');
    }

    await deleteMany(AuthAppModel, [reqBody.clientId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting QR auth code.'
    });
  }
};

export const updateAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateAuthAppRouteSuccessResponse | ErrorResponse>) => {
  try {
    const { name, description, image, redirectUris, clientId } = req.body as UpdateAuthAppRouteRequestBody;

    const doc = await mustGetFromDB(AuthAppModel, clientId);
    if (doc.createdBy !== req.session.cosmosAddress) {
      throw new Error('You must be the owner of the app.');
    }

    if (name !== undefined) {
      doc.name = name;
    }

    if (description !== undefined) {
      doc.description = description;
    }

    if (image !== undefined) {
      doc.image = await getImage(image);
    }

    if (redirectUris !== undefined) {
      doc.redirectUris = redirectUris;
    }

    await insertToDB(AuthAppModel, doc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error updating QR auth code.'
    });
  }
};
