import { type ClaimIntegrationPrivateParamsType, type ClaimIntegrationPublicParamsType } from 'bitbadgesjs-sdk';
import { ContextInfo, type BackendIntegrationPlugin, type ClaimIntegrationCustomBodyType } from './types';

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
    return await GenericOauthValidateFunction(
      context,
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      twitterInfo,
      context.instanceId
    );
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
  context: ContextInfo,
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
  const oauthInfoCopy = { ...oauthInfo };

  if (!oauthInfoCopy) {
    return { success: false, error: 'Invalid details. Could not get user.' };
  }

  if (!oauthInfoCopy.username || !oauthInfoCopy.id) {
    return { success: false, error: 'Invalid details. Could not get user.' };
  }

  if (oauthInfoCopy.id.includes('[dot]')) {
    return { success: false, error: 'Invalid reserved sequence in ID ([dot])' };
  }
  // Handle "." in oauthInfoCopy.id
  oauthInfoCopy.id = oauthInfoCopy.id.replace(/\./g, '[dot]');

  if (oauthInfoCopy.username.includes('[dot]')) {
    return { success: false, error: 'Invalid reserved sequence in username ([dot])' };
  }
  // Handle "." in oauthInfoCopy.username
  oauthInfoCopy.username = oauthInfoCopy.username.replace(/\./g, '[dot]');

  const currNumUses = priorState.ids[oauthInfoCopy.id] || 0;
  if (maxUsesPerUser > 0 && currNumUses >= maxUsesPerUser) {
    return { success: false, error: 'User already exceeded max uses' };
  }

  const hasSpecificUsers = (params.usernames ?? []).length > 0 || (params.ids ?? []).length > 0;
  let onList = false;
  let userIdx = -1;
  if (params.usernames && params.usernames.length > 0) {
    const convertedUsernames = params.usernames.map((user) => user.replace(/\./g, '[dot]'));

    const inList = convertedUsernames.some((user) => user === oauthInfoCopy.username);
    onList = inList;
    userIdx = convertedUsernames.findIndex((user) => user === oauthInfoCopy.username);
  }

  if (params.ids && params.ids.length > 0) {
    const convertedIds = params.ids.map((id) => id.replace(/\./g, '[dot]'));

    const inList = convertedIds.some((id) => id === oauthInfoCopy.id);
    onList = inList;
    userIdx = convertedIds.findIndex((id) => id === oauthInfoCopy.id) + (params.usernames?.length || 0);
  }

  const isBlacklist = publicParams.blacklist || false;
  if (hasSpecificUsers) {
    if (!isBlacklist && !onList) {
      return { success: false, error: 'User not in list of whitelisted users.' };
    } else if (isBlacklist && onList) {
      return { success: false, error: 'User is in list of blacklisted users.' };
    }
  }

  return {
    success: true,
    toSet: [
      { $set: { [`state.${instanceId}.ids.${oauthInfoCopy.id}`]: currNumUses + 1 } },
      { $set: { [`state.${instanceId}.usernames.${oauthInfoCopy.username}`]: oauthInfoCopy.id } }
    ],
    claimNumber: context.isClaimNumberAssigner ? userIdx : undefined
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
    return await GenericOauthValidateFunction(
      context,
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      googleInfo,
      context.instanceId
    );
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
    return await GenericOauthValidateFunction(
      context,
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      emailInfo,
      context.instanceId
    );
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
    return await GenericOauthValidateFunction(
      context,
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      githubInfo,
      context.instanceId
    );
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
      context,
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
    return await GenericOauthValidateFunction(
      context,
      publicParams,
      privateParams,
      customBody,
      priorState,
      globalState,
      githubInfo,
      context.instanceId
    );
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
