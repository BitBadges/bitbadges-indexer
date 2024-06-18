import { type ClaimIntegrationPrivateParamsType, type ClaimIntegrationPublicParamsType } from 'bitbadgesjs-sdk';
import { type BackendIntegrationPlugin, type ClaimIntegrationCustomBodyType } from './types';

export const TwitterPluginDetails: BackendIntegrationPlugin<'twitter'> = {
  pluginId: 'twitter',
  metadata: {
    name: 'Twitter',
    description: 'A twitter challenge',
    image: 'https://bitbadges.s3.amazonaws.com/twitter.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, twitterInfo) => {
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, twitterInfo, context.instanceId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

type OauthType = 'twitter' | 'discord' | 'github' | 'google' | 'email' | 'twitch';

export const GenericOauthValidateFunction = <P extends OauthType>(
  publicParams: ClaimIntegrationPublicParamsType<P>,
  privateParams: ClaimIntegrationPrivateParamsType<P>,
  customBody?: ClaimIntegrationCustomBodyType<P>,
  priorState?: any,
  globalState?: any,
  oauthInfo?: any,
  instanceId?: string
) => {
  const params = privateParams;
  const maxUsesPerUser = publicParams.maxUsesPerUser || 0;

  if (!oauthInfo) {
    return { success: false, error: 'Invalid details. Could not get user.' };
  }

  if (!oauthInfo.username || !oauthInfo.id) {
    return { success: false, error: 'Invalid details. Could not get user.' };
  }

  if (oauthInfo.id.includes('[dot]')) {
    return { success: false, error: 'Invalid reserved sequence in ID ([dot])' };
  }
  // Handle "." in oauthInfo.id
  oauthInfo.id = oauthInfo.id.replace(/\./g, '[dot]');

  if (oauthInfo.username.includes('[dot]')) {
    return { success: false, error: 'Invalid reserved sequence in username ([dot])' };
  }
  // Handle "." in oauthInfo.username
  oauthInfo.username = oauthInfo.username.replace(/\./g, '[dot]');

  const currNumUses = priorState.ids[oauthInfo.id] || 0;
  if (maxUsesPerUser > 0 && currNumUses >= maxUsesPerUser) {
    return { success: false, error: 'User already exceeded max uses' };
  }

  const requiresWhitelistCheck = (params.usernames ?? []).length > 0 || (params.ids ?? []).length > 0;
  let onWhitelist = false;
  if (params.usernames && params.usernames.length > 0) {
    const inList = params.usernames.some((user) => user === oauthInfo.username);
    onWhitelist = inList;
  }

  if (params.ids && params.ids.length > 0) {
    const inList = params.ids.some((id) => id === oauthInfo.id);
    onWhitelist = inList;
  }

  if (requiresWhitelistCheck && !onWhitelist) {
    return { success: false, error: 'User not in list of whitelisted users.' };
  }

  return {
    success: true,
    toSet: [
      { $set: { [`state.${instanceId}.ids.${oauthInfo.id}`]: currNumUses + 1 } },
      { $set: { [`state.${instanceId}.usernames.${oauthInfo.username}`]: oauthInfo.id } }
    ]
  };
};

export const GooglePluginDetails: BackendIntegrationPlugin<'google'> = {
  pluginId: 'google',
  metadata: {
    name: 'Google',
    description: 'A google challenge',
    image: 'https://bitbadges.s3.amazonaws.com/google.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, googleInfo) => {
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, googleInfo, context.instanceId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const EmailPluginDetails: BackendIntegrationPlugin<'email'> = {
  pluginId: 'email',
  metadata: {
    name: 'Email',
    description: 'Gate claims by email.',
    image: 'https://bitbadges.s3.amazonaws.com/email.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, emailInfo) => {
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, emailInfo, context.instanceId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const GitHubPluginDetails: BackendIntegrationPlugin<'github'> = {
  pluginId: 'github',
  metadata: {
    name: 'GitHub',
    description: 'A github challenge',
    image: 'https://bitbadges.s3.amazonaws.com/github.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, githubInfo) => {
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, githubInfo, context.instanceId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const DiscordPluginDetails: BackendIntegrationPlugin<'discord'> = {
  pluginId: 'discord',
  metadata: {
    name: 'Discord',
    description: 'A discord challenge',
    image: 'https://bitbadges.s3.amazonaws.com/discord.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
    const username = Number(adminInfo.discriminator) ? adminInfo.username + '#' + adminInfo.discriminator : adminInfo.username;

    return await GenericOauthValidateFunction(
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      { ...adminInfo, username },
      context.instanceId
    );
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  }
};

export const TwitchPluginDetails: BackendIntegrationPlugin<'twitch'> = {
  pluginId: 'twitch',
  metadata: {
    name: 'Twitch',
    description: '',
    image: '',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: { ids: {}, usernames: {} },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, githubInfo) => {
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, githubInfo, context.instanceId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
