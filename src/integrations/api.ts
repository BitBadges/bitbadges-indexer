import axios from 'axios';
import { getFromDB } from '../db/db';
import { PluginModel } from '../db/schemas';
import { handleIntegrationQuery } from './integration-query-handlers/integration-handlers';
import { ContextInfo } from './types';
import { PluginPresetType } from 'bitbadgesjs-sdk';
import { getMockAxiosResponse } from '../testutil/mockrequests';

axios.defaults.timeout = 10000;

export const GenericCustomPluginValidateFunction = async (
  context: ContextInfo & { instanceId: string; pluginId: string; _isSimulation: boolean },
  publicParams: any,
  privateParams: any,
  customBody: any,
  priorState: any,
  globalState: any,
  adminInfo: any,
  onSuccess?: (data: any) => Promise<{ success: boolean; toSet?: any[]; error?: string }>,
  stateFunctionPreset?: PluginPresetType
) => {
  const pluginDoc = await getFromDB(PluginModel, context.pluginId);
  if (!pluginDoc) {
    return { success: false, error: `Plugin ${context.pluginId} not found.` };
  }

  const apiCall = pluginDoc.verificationCall;
  if (!apiCall) {
    return { success: false, error: `No verification call found for plugin ${context.pluginId}.` };
  }

  const body = {
    ...customBody,
    ...publicParams,
    ...privateParams,
    ...apiCall?.hardcodedInputs.map((input) => ({ [input.key]: input.value })),
    priorState:
      stateFunctionPreset === PluginPresetType.StateTransitions
        ? priorState
        : stateFunctionPreset === PluginPresetType.ClaimNumbers
          ? adminInfo.numUsesState
          : null,
    discord: apiCall?.passDiscord ? adminInfo.discord : null,
    twitter: apiCall?.passTwitter ? adminInfo.twitter : null,
    github: apiCall?.passGithub ? adminInfo.github : null,
    google: apiCall?.passGoogle ? adminInfo.google : null,
    twitch: apiCall?.passTwitch ? adminInfo.twitch : null,
    email: apiCall?.passEmail ? adminInfo.email : null,

    // Context info
    pluginSecret: pluginDoc.pluginSecret,
    claimId: context.claimId,
    maxUses: context.maxUses,
    currUses: context.currUses,
    cosmosAddress: apiCall?.passAddress ? context.cosmosAddress : null,
    claimAttemptId: context.claimAttemptId,
    _isSimulation: context._isSimulation,
    lastUpdated: context.lastUpdated,
    createdAt: context.createdAt
  };

  try {
    // For manually implement
    if (apiCall?.uri.startsWith('https://api.bitbadges.io/api/v0/integrations/query')) {
      await handleIntegrationQuery({
        ...body,
        __type: apiCall.uri.split('/').pop()
      });
    } else {
      if (process.env.TEST_MODE !== 'true') {
        if ((apiCall.uri.includes('localhost') && process.env.DEV_MODE !== 'true') || apiCall?.uri.includes('api.bitbadges.io')) {
          throw new Error('Cannot call localhost or BitBadges API.');
        }
      }

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
      if (body.twitch) {
        body.twitch = { id: body.twitch.id, username: body.twitch.username };
      }
      if (body.email) {
        body.email = body.email;
      }

      let axiosRes = null;
      if (process.env.TEST_MODE === 'true') {
        axiosRes = getMockAxiosResponse(apiCall.uri);
      } else {
        if (apiCall.method === 'GET') {
          axiosRes = await axios.get(apiCall.uri, {
            params: {
              ...body
            }
          });
        } else if (apiCall.method === 'POST' || !apiCall.method) {
          //default to POST
          axiosRes = await axios.post(apiCall.uri, {
            ...body
          });
        } else if (apiCall.method === 'PUT') {
          axiosRes = await axios.put(apiCall.uri, {
            ...body
          });
        } else if (apiCall.method === 'DELETE') {
          axiosRes = await axios.delete(apiCall.uri, {
            data: {
              ...body
            }
          });
        }
      }

      if (!axiosRes || axiosRes.status !== 200) {
        return { success: false, error: `Error calling API` };
      }

      if (onSuccess) {
        return await onSuccess(axiosRes.data);
      }
    }
  } catch (e) {
    return { success: false, error: e.message };
  }

  return { success: true };
};
