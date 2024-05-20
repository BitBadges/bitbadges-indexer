import {
  GetPluginBody,
  type CreatePluginBody,
  type ErrorResponse,
  type NumberType,
  type iCreatePluginSuccessResponse,
  type iGetPluginSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { PluginModel } from '../db/schemas';
import { getCorePlugin } from '../integrations/types';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

export const createPlugin = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreatePluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as CreatePluginBody;
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');

    // Check if existing plugin w/ same name
    const isCorePlugin = getCorePlugin(reqBody.pluginId);
    const existingDoc = await getFromDB(PluginModel, reqBody.pluginId);
    if (!!isCorePlugin || !!existingDoc) {
      return res.status(400).send({
        error: 'Plugin with that ID already exists.'
      });
    }

    let image = reqBody.metadata.image;
    if (image.startsWith('data:')) {
      const results = await addMetadataToIpfs([
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

    //TODO: Validate this even more

    await insertToDB(PluginModel, {
      ...reqBody,
      createdBy: req.session.cosmosAddress,
      metadata: {
        ...reqBody.metadata,
        image
      },
      _docId: reqBody.pluginId,
      pluginSecret: uniqueClientSecret,
      reviewCompleted: true //TODO: Add review process
    });

    return res.status(200).send({});
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error creating plugin.'
    });
  }
};

export const getPlugins = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetPluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetPluginBody;
    const { createdPluginsOnly } = reqBody;

    if (!!createdPluginsOnly) {
      if (!checkIfAuthenticated(req, ['Full Access'])) {
        return res.status(401).send({
          errorMessage: 'Unauthorized. Please sign in to fetch your created plugins.'
        });
      }
    }

    const docs = await findInDB(PluginModel, {
      query: {
        reviewCompleted: true,
        ...(createdPluginsOnly ? { 'metadata.createdBy': req.session.cosmosAddress } : {})
      },
      limit: 1000
    });

    return res.status(200).send({
      plugins: docs.map((doc) => {
        if (!createdPluginsOnly) {
          delete doc.pluginSecret;
        }
        return doc;
      })
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting plugins.'
    });
  }
};
