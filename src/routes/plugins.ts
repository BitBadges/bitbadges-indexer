import {
  GetPluginPayload,
  type CreatePluginPayload,
  type ErrorResponse,
  type NumberType,
  type iCreatePluginSuccessResponse,
  type iGetPluginSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, type AuthenticatedRequest, mustGetAuthDetails, getAuthDetails } from '../blockin/blockin_handlers';
import { getFromDB, insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { PluginModel } from '../db/schemas';
import { getCorePlugin } from '../integrations/types';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

export const createPlugin = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreatePluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as CreatePluginPayload;
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');

    if (uniqueClientSecret) {
      return res.status(400).send({ errorMessage: 'This endpoint is disabled.' });
    }

    // Check if existing plugin w/ same name
    const isCorePlugin = getCorePlugin(reqPayload.pluginId);
    const existingDoc = await getFromDB(PluginModel, reqPayload.pluginId);
    if (!!isCorePlugin || !!existingDoc) {
      return res.status(400).send({
        error: 'Plugin with that ID already exists.'
      });
    }

    let image = reqPayload.metadata.image;
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

    //TODO: Add review process,
    //TODO: Validate this even more
    const authDetails = await mustGetAuthDetails(req);
    await insertToDB(PluginModel, {
      ...reqPayload,
      createdBy: authDetails.cosmosAddress,
      metadata: {
        ...reqPayload.metadata,
        image
      },

      _docId: reqPayload.pluginId,
      pluginSecret: uniqueClientSecret,
      reviewCompleted: true,
      lastUpdated: Date.now()
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

export const getPlugins = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetPluginSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetPluginPayload;
    const { createdPluginsOnly } = reqPayload;

    if (!!createdPluginsOnly) {
      const isAuthenticated = await checkIfAuthenticated(req, ['Full Access']);
      if (!isAuthenticated) {
        return res.status(401).send({
          errorMessage: 'Unauthorized. Please sign in to fetch your created plugins.'
        });
      }
    }

    const authDetails = await getAuthDetails(req);
    const docs = await findInDB(PluginModel, {
      query: {
        reviewCompleted: true,
        ...(createdPluginsOnly && authDetails ? { 'metadata.createdBy': authDetails?.cosmosAddress } : {})
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
