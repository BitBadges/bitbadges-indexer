import { type NumberType } from 'bitbadgesjs-sdk';

import axios from 'axios';
import { type BackendIntegrationPlugin } from './types';
import { handleIntegrationQuery } from './integration-query-handlers/integration-handlers';
import { getFromDB, insertToDB } from '../db/db';
import { ExternalCallKeysModel } from '../db/schemas';
import crypto from 'crypto';

export const ApiPluginDetails: BackendIntegrationPlugin<NumberType, 'api'> = {
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

          const authBodyDetails: any = {};
          if (adminInfo.discord) {
            authBodyDetails.discord = {
              id: adminInfo.discord.id,
              username: adminInfo.discord.username,
              discriminator: adminInfo.discord.discriminator
            };
          }
          if (adminInfo.twitter) {
            authBodyDetails.twitter = { id: adminInfo.twitter.id, username: adminInfo.twitter.username };
          }
          if (adminInfo.github) {
            authBodyDetails.github = { id: adminInfo.github.id, username: adminInfo.github.username };
          }
          if (adminInfo.google) {
            authBodyDetails.google = { id: adminInfo.google.id, username: adminInfo.google.username };
          }
          if (adminInfo.email) {
            authBodyDetails.email = adminInfo.email;
          }

          await axios.post(apiCall.uri, {
            ...body,
            __key: randomKey,
            // Don't send access tokens and other sensitive info
            ...authBodyDetails
          });
        }
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    return { success: true };
  },
  getPublicState: (currState) => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return {};
  },
  decryptPrivateParams: (privateParams) => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  }
};
