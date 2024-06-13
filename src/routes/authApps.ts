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
import { typiaError } from './search';
import typia from 'typia';

export const createDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCreateDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as CreateDeveloperAppPayload;
    const validateRes: typia.IValidation<CreateDeveloperAppPayload> = typia.validate<CreateDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const uniqueClientId = crypto.randomBytes(32).toString('hex');
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');
    const authDetails = await mustGetAuthDetails(req, res);

    if (reqPayload.image.startsWith('data:')) {
      const res = await addMetadataToIpfs([{ name: '', description: '', image: reqPayload.image }]);
      const metadata = await getFromIpfs(res[0].cid);
      reqPayload.image = JSON.parse(metadata.file).image;
    }

    const clientSecretHash = crypto.createHash('sha256').update(uniqueClientSecret).digest('hex');

    await insertToDB(DeveloperAppModel, {
      createdBy: authDetails.cosmosAddress,
      _docId: uniqueClientId,
      clientId: uniqueClientId,
      clientSecret: clientSecretHash,
      name: reqPayload.name,
      redirectUris: reqPayload.redirectUris,
      description: reqPayload.description,
      image: reqPayload.image
    });

    return res.status(200).send({ clientId: uniqueClientId, clientSecret: uniqueClientSecret });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error creating app.'
    });
  }
};

export const getDeveloperApps = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetDeveloperAppSuccessResponse | ErrorResponse>) => {
  try {
    const body = req.body as unknown as GetDeveloperAppPayload;
    const validateRes: typia.IValidation<GetDeveloperAppPayload> = typia.validate<GetDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    if (body.clientId) {
      const doc = await mustGetFromDB(DeveloperAppModel, body.clientId);
      //Prune the client secret
      doc.clientSecret = '';
      return res.status(200).send({ developerApps: [doc] });
    } else {
      const isAuthenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Full Access' }]);
      if (!isAuthenticated) {
        return res.status(401).send({ errorMessage: 'You must be authorized.' });
      }
      const authDetails = await mustGetAuthDetails(req, res);
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting app.'
    });
  }
};

export const deleteDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const reqPayload = req.body as DeleteDeveloperAppPayload;
    const validateRes: typia.IValidation<DeleteDeveloperAppPayload> = typia.validate<DeleteDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const authDetails = await mustGetAuthDetails(req, res);
    const doc = await mustGetFromDB(DeveloperAppModel, reqPayload.clientId);
    if (doc.createdBy !== authDetails.cosmosAddress) {
      throw new Error('You are not the owner of this request.');
    }

    await deleteMany(DeveloperAppModel, [reqPayload.clientId]);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error deleting app.'
    });
  }
};

export const updateDeveloperApp = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateDeveloperAppSuccessResponse | ErrorResponse>
) => {
  try {
    const { name, description, image, redirectUris, clientId, rotateClientSecret } = req.body as UpdateDeveloperAppPayload;
    const validateRes: typia.IValidation<UpdateDeveloperAppPayload> = typia.validate<UpdateDeveloperAppPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const authDetails = await mustGetAuthDetails(req, res);
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

    let newClientSecret = '';
    if (rotateClientSecret) {
      newClientSecret = crypto.randomBytes(32).toString('hex');
      doc.clientSecret = crypto.createHash('sha256').update(newClientSecret).digest('hex');
    }

    await insertToDB(DeveloperAppModel, doc);

    return res.status(200).send({ success: true, clientSecret: newClientSecret });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error updating app.'
    });
  }
};
