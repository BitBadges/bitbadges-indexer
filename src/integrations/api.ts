import axios from 'axios';
import crypto from 'crypto';
import { getFromDB, insertToDB } from '../db/db';
import { ExternalCallKeysModel } from '../db/schemas';
import { handleIntegrationQuery } from './integration-query-handlers/integration-handlers';
import { type BackendIntegrationPlugin } from './types';

export const ApiPluginDetails: BackendIntegrationPlugin<'api'> = {
  id: 'api',
  metadata: {
    name: 'Custom API Calls',
    description: 'Call your own API for custom validation checks.',
    image: 'https://bitbadges.s3.amazonaws.com/password.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, glboalState, adminInfo) => {
    const apiCalls = publicParams.apiCalls;

    for (let i = 0; i < apiCalls.length; i++) {
      const apiCall = apiCalls[i];
      const body = {
        ...apiCall.bodyParams,
        ...customBody?.[i],
        claimId: context.claimId,
        cosmosAddress: apiCall.passAddress ? context.cosmosAddress : null,
        discord: apiCall.passDiscord ? adminInfo.discord : null,
        twitter: apiCall.passTwitter ? adminInfo.twitter : null,
        github: apiCall.passGithub ? adminInfo.github : null,
        google: apiCall.passGoogle ? adminInfo.google : null,
        email: apiCall.passEmail ? adminInfo.email : null
      };

      try {
        // TODO: timeout and handle correctly?
        if (apiCall.uri.startsWith('https://api.bitbadges.io/api/v0/integrations/query')) {
          await handleIntegrationQuery({
            ...body,
            __type: apiCall.uri.split('/').pop()
          });
        } else {
          const keysDoc = await getFromDB(ExternalCallKeysModel, apiCall.uri);
          if (!keysDoc) {
            await insertToDB(ExternalCallKeysModel, { _docId: apiCall.uri, keys: [] });
          }

          const randomKey = crypto.randomBytes(32).toString('hex');
          await ExternalCallKeysModel.findOneAndUpdate(
            { _docId: apiCall.uri },
            {
              $push: {
                keys: {
                  key: randomKey,
                  timestamp: Date.now()
                }
              }
            }
          );

          //IMPORTANT: Don't send access tokens and other sensitive info
          //adminInfo has such info and is used by the integration queries internally but should not be sent out

          if (body.discord) {
            body.discord = {
              id: body.discord.id,
              username: body.discord.username,
              discriminator: body.discord.discriminator
            };
          }
          if (body.twitter) {
            body.twitter = { id: body.twitter.id, username: body.twitter.username };
          }
          if (body.github) {
            body.github = { id: body.github.id, username: body.github.username };
          }
          if (body.google) {
            body.google = { id: body.google.id, username: body.google.username };
          }
          if (body.email) {
            body.email = body.email;
          }

          if (apiCall.method === 'GET') {
            await axios.get(apiCall.uri, {
              params: {
                __key: randomKey,
                ...body
              }
            });
          } else if (apiCall.method === 'POST' || !apiCall.method) {
            //default to POST
            await axios.post(apiCall.uri, {
              __key: randomKey,
              ...body
            });
          } else if (apiCall.method === 'PUT') {
            await axios.put(apiCall.uri, {
              __key: randomKey,
              ...body
            });
          } else if (apiCall.method === 'DELETE') {
            await axios.delete(apiCall.uri, {
              data: {
                __key: randomKey,
                ...body
              }
            });
          }
        }
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    return { success: true };
  },
  getPublicState: () => {
    return {};
  },
  encryptPrivateParams: () => {
    return {};
  },
  decryptPrivateParams: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  }
};
