import { type ClaimIntegrationPrivateParamsType, type ClaimIntegrationPublicParamsType } from 'bitbadgesjs-sdk';
import { type BackendIntegrationPlugin, type ClaimIntegrationCustomBodyType } from './types';

export const TwitterPluginDetails: BackendIntegrationPlugin<'twitter'> = {
  type: 'twitter',
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
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, twitterInfo, context.pluginId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

type OauthType = 'twitter' | 'discord' | 'github' | 'google' | 'email';

export const GenericOauthValidateFunction = <P extends OauthType>(
  publicParams: ClaimIntegrationPublicParamsType<P>,
  privateParams: ClaimIntegrationPrivateParamsType<P>,
  customBody?: ClaimIntegrationCustomBodyType<P>,
  priorState?: any,
  globalState?: any,
  oauthInfo?: any,
  pluginId?: string
) => {
  const params = privateParams;
  const maxUsesPerUser = publicParams.maxUsesPerUser || 0;

  if (!oauthInfo) {
    return { success: false, error: 'Invalid details. Could not get user.' };
  }

  if (!oauthInfo.username) {
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

  if (priorState.ids[oauthInfo.id] && maxUsesPerUser > 0 && priorState.ids[oauthInfo.id] >= maxUsesPerUser) {
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
      { $set: { [`state.${pluginId}.ids.${oauthInfo.id}`]: 1 } },
      { $set: { [`state.${pluginId}.usernames.${oauthInfo.username}`]: oauthInfo.id } }
    ]
  };
};

export const GooglePluginDetails: BackendIntegrationPlugin<'google'> = {
  type: 'google',
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
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, googleInfo, context.pluginId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

// export const EmailPluginDetails: BackendIntegrationPlugin<'email'> = {
//   type: 'email',
//   metadata: {
//     name: 'Email',
//     description: 'Gate claims by email.',
//     image: 'https://bitbadges.s3.amazonaws.com/email.png',
//     createdBy: 'BitBadges',
//     stateless: false,
//     scoped: true,
//     duplicatesAllowed: false
//   },
//   defaultState: { ids: {}, usernames: {} },
//   encryptPrivateParams: (privateParams) => {
//     return privateParams;
//   },
//   decryptPrivateParams: (privateParams) => {
//     return privateParams;
//   },
//   validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, emailInfo) => {
//     return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, emailInfo, context.pluginId);
//   },
//   getPublicState: () => {
//     return {};
//   },
//   getBlankPublicState() {
//     return {};
//   }
// };

export const GitHubPluginDetails: BackendIntegrationPlugin<'github'> = {
  type: 'github',
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
    return await GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, githubInfo, context.pluginId);
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const DiscordPluginDetails: BackendIntegrationPlugin<'discord'> = {
  type: 'discord',
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
      context.pluginId
    );
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  }
};
