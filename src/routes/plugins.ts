import {
  GetPluginPayload,
  type CreatePluginPayload,
  type ErrorResponse,
  type NumberType,
  type iCreatePluginSuccessResponse,
  type iGetPluginSuccessResponse,
  UpdatePluginPayload,
  iUpdatePluginSuccessResponse,
  convertToCosmosAddress
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, type AuthenticatedRequest, mustGetAuthDetails, getAuthDetails } from '../blockin/blockin_handlers';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { PluginModel } from '../db/schemas';
import { getCorePlugin } from '../integrations/types';
import { addMetadataToIpfs, getFromIpfs } from '../ipfs/ipfs';

const getImage = async (image: string) => {
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
  return image;
};

export const validatePlugin = (reqPayload: CreatePluginPayload) => {
  // if (reqPayload?.userInputsSchema.length > 0) {
  //   return 'User inputs schema not supported yet.';
  // }

  // if (reqPayload.requiresSessions) {
  //   return 'Requires sessions not supported yet.';
  // }

  if (reqPayload.requiresUserInputs && !reqPayload.userInputRedirect?.baseUri) {
    return 'Must specify a frontend base URI for user inputs.';
  }

  // if (reqPayload?.verificationCall?.hardcodedInputs?.length) {
  //   return 'Hardcoded inputs not supported yet.';
  // }

  // //TODO: Handle with the username / select
  // if (reqPayload?.publicParamsSchema?.length) {
  //   return 'Public params schema not supported yet.';
  // }

  // if (
  //   reqPayload.verificationCall?.passAddress ||
  //   reqPayload.verificationCall?.passDiscord ||
  //   reqPayload.verificationCall?.passTwitter ||
  //   reqPayload.verificationCall?.passGoogle ||
  //   reqPayload.verificationCall?.passGithub
  // ) {
  //   return 'Passing socials not supported yet.';
  // }

  // if (reqPayload?.privateParamsSchema?.length) {
  //   return 'Private params schema not supported yet.';
  // }

  return undefined;
};

export const updatePlugin = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdatePluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as UpdatePluginPayload;

    const existingDoc = await mustGetFromDB(PluginModel, reqPayload.pluginId);
    const authDetails = await mustGetAuthDetails(req, res);
    if (existingDoc.createdBy !== authDetails.cosmosAddress) {
      return res.status(400).send({
        error: 'You must be the owner of the plugin.'
      });
    }
    const newDoc = { ...existingDoc };
    if (reqPayload.verificationCall !== undefined)
      newDoc.verificationCall = {
        ...(existingDoc.verificationCall ?? {
          passAddress: false,
          passDiscord: false,
          passTwitter: false,
          passGoogle: false,
          passGithub: false,
          hardcodedInputs: []
        }),
        ...reqPayload.verificationCall
      };
    if (reqPayload.requiresUserInputs !== undefined) newDoc.requiresUserInputs = reqPayload.requiresUserInputs;
    if (reqPayload.userInputRedirect !== undefined) newDoc.userInputRedirect = reqPayload.userInputRedirect;
    if (reqPayload.claimCreatorRedirect !== undefined) newDoc.claimCreatorRedirect = reqPayload.claimCreatorRedirect;
    if (reqPayload.duplicatesAllowed !== undefined) newDoc.duplicatesAllowed = reqPayload.duplicatesAllowed;
    if (reqPayload.reuseForNonIndexed !== undefined) newDoc.reuseForNonIndexed = reqPayload.reuseForNonIndexed;
    if (reqPayload.toPublish !== undefined) newDoc.toPublish = reqPayload.toPublish;
    if (reqPayload.toPublish === false) newDoc.reviewCompleted = false;
    if (reqPayload.approvedUsers !== undefined) newDoc.approvedUsers = reqPayload.approvedUsers.map((user) => convertToCosmosAddress(user));

    const image = reqPayload.metadata?.image ? await getImage(reqPayload.metadata.image) : reqPayload.metadata?.image;
    if (reqPayload.metadata !== undefined)
      newDoc.metadata = {
        ...existingDoc.metadata,
        ...reqPayload.metadata,
        image: image !== undefined ? image : existingDoc.metadata.image,
        createdBy: existingDoc.createdBy
      };

    await insertToDB(PluginModel, {
      ...newDoc,
      lastUpdated: Date.now()
    });

    return res.status(200).send({});
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error updating plugin.'
    });
  }
};

export const deletePlugin = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdatePluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as UpdatePluginPayload;
    const authDetails = await mustGetAuthDetails(req, res);
    const existingDoc = await mustGetFromDB(PluginModel, reqPayload.pluginId);
    if (!existingDoc) {
      return res.status(400).send({
        error: 'Plugin with that ID does not exist.'
      });
    }

    if (existingDoc.createdBy !== authDetails.cosmosAddress) {
      return res.status(400).send({
        error: 'You must be the owner of the plugin.'
      });
    }

    await insertToDB(PluginModel, {
      ...existingDoc,
      reviewCompleted: false,
      deletedAt: Date.now(),
      lastUpdated: Date.now()
    });

    return res.status(200).send({});
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error deleting plugin.'
    });
  }
};

export const createPlugin = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreatePluginSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as CreatePluginPayload;
    const uniqueClientSecret = crypto.randomBytes(32).toString('hex');
    const validationErr = validatePlugin(reqPayload);
    if (validationErr) {
      return res.status(400).json({ errorMessage: validationErr });
    }

    // Check if existing plugin w/ same name
    const isCorePlugin = getCorePlugin(reqPayload.pluginId);
    const existingDoc = await getFromDB(PluginModel, reqPayload.pluginId);
    if (!!isCorePlugin || !!existingDoc) {
      return res.status(400).send({
        error: 'Plugin with that ID already exists.'
      });
    }

    const image = await getImage(reqPayload.metadata.image);
    const authDetails = await mustGetAuthDetails(req, res);
    await insertToDB(PluginModel, {
      ...reqPayload,
      createdBy: authDetails.cosmosAddress,
      metadata: {
        ...reqPayload.metadata,
        image
      },
      approvedUsers: reqPayload.approvedUsers?.map((user) => convertToCosmosAddress(user)) ?? [],
      verificationCall: reqPayload.verificationCall
        ? {
            ...reqPayload.verificationCall,
            hardcodedInputs: [],
            passAddress: false,
            passDiscord: false,
            passTwitter: false,
            passGoogle: false,
            passGithub: false
          }
        : undefined,
      publicParamsSchema: [],
      privateParamsSchema: [],
      userInputsSchema: [],
      toPublish: reqPayload.toPublish ?? false,
      requiresSessions: false,
      _docId: reqPayload.pluginId,
      pluginSecret: uniqueClientSecret,
      reviewCompleted: false,
      userInputRedirect: reqPayload.requiresUserInputs ? reqPayload.userInputRedirect : undefined,
      claimCreatorRedirect: reqPayload.requiresUserInputs ? reqPayload.claimCreatorRedirect : undefined,
      lastUpdated: Date.now(),
      createdAt: Date.now()
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
    const { createdPluginsOnly, pluginId } = reqPayload;

    if (pluginId) {
      const doc = await mustGetFromDB(PluginModel, pluginId);

      return res.status(200).send({
        plugins: [{ ...doc, pluginSecret: undefined }]
      });
    }

    if (!!createdPluginsOnly) {
      const isAuthenticated = await checkIfAuthenticated(req, res, ['Full Access']);
      if (!isAuthenticated) {
        return res.status(401).send({
          errorMessage: 'Unauthorized. Please sign in to fetch your created plugins.'
        });
      }
    }

    const authDetails = await getAuthDetails(req, res);
    const docs = await findInDB(PluginModel, {
      query: {
        // ...(createdPluginsOnly ? {} : { reviewCompleted: true }),
        deletedAt: { $exists: false },
        ...(createdPluginsOnly && authDetails ? { createdBy: authDetails?.cosmosAddress } : {})
      },
      limit: 1000
    });

    // We also need to fetch the plugins that the user has been approved / invited to
    if (createdPluginsOnly && authDetails?.cosmosAddress) {
      const approvedDocs = await findInDB(PluginModel, {
        query: {
          approvedUsers: { $elemMatch: { $eq: authDetails.cosmosAddress } }
        },
        limit: 1000
      });
      docs.push(
        ...approvedDocs.map((doc) => {
          delete doc.pluginSecret;
          return doc;
        })
      );
    }

    return res.status(200).send({
      plugins: docs
        .map((doc) => {
          if (!createdPluginsOnly) {
            delete doc.pluginSecret;
          }
          return doc;
        })
        .filter((x, i, self) => self.findIndex((t) => t._docId === x._docId) === i)
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting plugins.'
    });
  }
};
