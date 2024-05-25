import {
  GetDeveloperAppPayload,
  type CreateDeveloperAppPayload,
  type DeleteDeveloperAppPayload,
  type ErrorResponse,
  type NumberType,
  type UpdateDeveloperAppPayload,
  type iCreateDeveloperAppSuccessResponse,
  type iDeleteDeveloperAppSuccessResponse,
  type iGetDeveloperAppSuccessResponse,
  type iUpdateDeveloperAppSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';
import { checkIfAuthenticated, mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { DeveloperAppModel } from '../db/schemas';

export const createDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCreateDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as CreateDeveloperAppPayload;

    const uniqueClientId = crypto.randomBytes(32).toString('hex');
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');
    const authDetails = await mustGetAuthDetails(req);

    if (reqPayload.image.startsWith('data:')) {
      const res = await addMetadataToIpfs([{ name: '', description: '', image: reqPayload.image }]);
      const metadata = await getFromIpfs(res[0].cid);
      reqPayload.image = JSON.parse(metadata.file).image;
    }

    await insertToDB(DeveloperAppModel, {
      createdBy: authDetails.cosmosAddress,
      _docId: uniqueClientId,
      clientId: uniqueClientId,
      clientSecret: uniqueClientSecret,
      name: reqPayload.name,
      redirectUris: reqPayload.redirectUris,
      description: reqPayload.description,
      image: reqPayload.image
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

export const getDeveloperApps = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetDeveloperAppSuccessResponse | ErrorResponse>) => {
  try {
    const body = req.body as unknown as GetDeveloperAppPayload;

    if (body.clientId) {
      const doc = await mustGetFromDB(DeveloperAppModel, body.clientId);
      //Prune the client secret
      doc.clientSecret = '';
      return res.status(200).send({ developerApps: [doc] });
    } else {
      const isAuthenticated = await checkIfAuthenticated(req, ['Full Access']);
      if (!isAuthenticated) {
        return res.status(401).send({ errorMessage: 'You must be authorized.' });
      }
      const authDetails = await mustGetAuthDetails(req);
      const docs = await findInDB(DeveloperAppModel, {
        query: {
          createdBy: authDetails.cosmosAddress
        }
      });
      return res.status(200).send({ developerApps: docs });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting auth app.'
    });
  }
};

export const deleteDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as DeleteDeveloperAppPayload;
    const authDetails = await mustGetAuthDetails(req);
    const doc = await mustGetFromDB(DeveloperAppModel, reqPayload.clientId);
    if (doc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this Siwbb request.');
    }

    await deleteMany(DeveloperAppModel, [reqPayload.clientId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error deleting auth app.'
    });
  }
};

export const updateDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const { name, description, image, redirectUris, clientId } = req.body as UpdateDeveloperAppPayload;
    const authDetails = await mustGetAuthDetails(req);
    const doc = await mustGetFromDB(DeveloperAppModel, clientId);
    if (doc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You must be the owner of the app.');
    }

    if (name !== undefined) {
      doc.name = name;
    }

    if (description !== undefined) {
      doc.description = description;
    }

    if (image !== undefined) {
      if (image.startsWith('data:')) {
        const res = await addMetadataToIpfs([{ name: '', description: '', image: image }]);
        const metadata = await getFromIpfs(res[0].cid);
        doc.image = JSON.parse(metadata.file).image;
      } else {
        doc.image = image;
      }
    }

    if (redirectUris !== undefined) {
      doc.redirectUris = redirectUris;
    }

    await insertToDB(DeveloperAppModel, doc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error updating auth app.'
    });
  }
};
