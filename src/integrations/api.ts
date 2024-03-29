import { NumberType } from 'bitbadgesjs-sdk';

import axios from 'axios';
import { BackendIntegrationPlugin } from './types';
import { handleIntegrationQuery } from './integration-query-handlers/integration-handlers';

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
        // stripe: apiCall.passStripe ? adminInfo.stripe : null
      };

      try {
        //TODO: timeout and handle correctly?
        if (apiCall.uri.startsWith('https://api.bitbadges.io/api/v0/integrations/query')) {
          await handleIntegrationQuery({
            __type: apiCall.uri.split('/').pop(),
            ...body
          });
        } else {
          await axios.post(apiCall.uri, {
            ...body,
            //Don't send access tokens and other sensitive info
            discord: { id: adminInfo.discord.id, username: adminInfo.discord.username, discriminator: adminInfo.discord.discriminator },
            twitter: { id: adminInfo.twitter.id, username: adminInfo.twitter.username },
            github: { id: adminInfo.github.id, username: adminInfo.github.username },
            google: { id: adminInfo.google.id, username: adminInfo.google.username },
            // stripe: { id: adminInfo.stripe.id, username: adminInfo.stripe.username }
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
