import {
  type CreateAuthAppBody,
  type DeleteAuthAppBody,
  type ErrorResponse,
  type NumberType,
  type UpdateAuthAppBody,
  type iCreateAuthAppSuccessResponse,
  type iDeleteAuthAppSuccessResponse,
  type iGetAuthAppSuccessResponse,
  type iUpdateAuthAppSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AuthAppModel } from '../db/schemas';

export const createAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateAuthAppSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as CreateAuthAppBody;

    const uniqueClientId = crypto.randomBytes(32).toString('hex');
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');

    await insertToDB(AuthAppModel, {
      createdBy: req.session.cosmosAddress,
      _docId: uniqueClientId,
      clientId: uniqueClientId,
      clientSecret: uniqueClientSecret,
      name: reqBody.name,
      redirectUris: reqBody.redirectUris
    });

    return res.status(200).send({ clientId: uniqueClientId, clientSecret: uniqueClientSecret });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error creating auth app.'
    });
  }
};

export const getAuthApps = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetAuthAppSuccessResponse | ErrorResponse>) => {
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
      errorMessage: e.message || 'Error getting auth app.'
    });
  }
};

export const deleteAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iDeleteAuthAppSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as DeleteAuthAppBody;

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
      errorMessage: e.message || 'Error deleting auth app.'
    });
  }
};

export const updateAuthApp = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateAuthAppSuccessResponse | ErrorResponse>) => {
  try {
    const { name, redirectUris, clientId } = req.body as UpdateAuthAppBody;

    const doc = await mustGetFromDB(AuthAppModel, clientId);
    if (doc.createdBy !== req.session.cosmosAddress) {
      throw new Error('You must be the owner of the app.');
    }

    if (name !== undefined) {
      doc.name = name;
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
      errorMessage: e.message || 'Error updating auth app.'
    });
  }
};
