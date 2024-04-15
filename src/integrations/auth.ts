import axios from 'axios';
import { ClaimIntegrationPrivateParamsType, ClaimIntegrationPublicParamsType, NumberType } from 'bitbadgesjs-sdk';
import { BackendIntegrationPlugin, ClaimIntegrationCustomBodyType } from './types';

export const TwitterPluginDetails: BackendIntegrationPlugin<NumberType, 'twitter'> = {
  id: 'twitter',
  metadata: {
    name: 'Twitter',
    description: 'A twitter challenge',
    image: 'https://bitbadges.s3.amazonaws.com/twitter.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, twitterInfo) => {
    return GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, twitterInfo, 'twitter');
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

type OauthType = 'twitter' | 'discord' | 'github' | 'google' | 'email';

export const GenericOauthValidateFunction = async <P extends OauthType>(
  publicParams: ClaimIntegrationPublicParamsType<P>,
  privateParams: ClaimIntegrationPrivateParamsType<P>,
  customBody?: ClaimIntegrationCustomBodyType<P>,
  priorState?: any,
  globalState?: any,
  oauthInfo?: any,
  pluginId?: string
) => {
  const params = publicParams.users?.length ? publicParams : privateParams;

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

  //Handle "." in oauthInfo.id
  oauthInfo.id = oauthInfo.id.replace(/\./g, '[dot]');

  if (priorState[oauthInfo.id] && maxUsesPerUser > 0 && priorState[oauthInfo.id] >= maxUsesPerUser) {
    return { success: false, error: 'User already exceeded max uses' };
  }

  if (params.users && params.users.length > 0) {
    const inList = params.users.some((user) => user === oauthInfo.username);
    if (!inList) {
      return { success: false, error: 'User not in list of whitelisted users.' };
    }
  }

  return { success: true, toSet: [{ $set: { [`state.${pluginId}.${oauthInfo.id}`]: 1 } }] };
};

export const GooglePluginDetails: BackendIntegrationPlugin<NumberType, 'google'> = {
  id: 'google',
  metadata: {
    name: 'Google',
    description: 'A google challenge',
    image: 'https://bitbadges.s3.amazonaws.com/google.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, googleInfo) => {
    return GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, googleInfo, 'google');
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const EmailPluginDetails: BackendIntegrationPlugin<NumberType, 'email'> = {
  id: 'email',
  metadata: {
    name: 'Email',
    description: 'Gate claims by email.',
    image: 'https://bitbadges.s3.amazonaws.com/email.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, emailInfo) => {
    return GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, emailInfo, 'email');
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const GitHubPluginDetails: BackendIntegrationPlugin<NumberType, 'github'> = {
  id: 'github',
  metadata: {
    name: 'GitHub',
    description: 'A github challenge',
    image: 'https://bitbadges.s3.amazonaws.com/github.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, githubInfo) => {
    return GenericOauthValidateFunction(publicParams, privateParams, customBody, priorState, globalState, githubInfo, 'github');
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};

export const DiscordPluginDetails: BackendIntegrationPlugin<NumberType, 'discord'> = {
  id: 'discord',
  metadata: {
    name: 'Discord',
    description: 'A discord challenge',
    image: 'https://bitbadges.s3.amazonaws.com/discord.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
    const params = publicParams.users?.length || publicParams.serverId ? publicParams : privateParams;

    const maxUsesPerUser = publicParams.maxUsesPerUser || 0;

    const serverId = params.serverId;
    const discordInfo = adminInfo;
    const userId = discordInfo.id;
    const username = discordInfo.username;
    const discriminator = discordInfo.discriminator ? Number(discordInfo.discriminator) : undefined;
    const guildId = serverId;
    const access_token = discordInfo.access_token;
    if (!discordInfo.id || !discordInfo.username) {
      return { success: false, error: 'Invalid discord ID' };
    }

    if (priorState[userId] && maxUsesPerUser > 0 && priorState[userId] >= maxUsesPerUser) {
      return { success: false, error: 'Discord user already exceeded max uses' };
    }

    //Check if user ID is in list of whitelisted users (if applicable)
    if (params.users && params.users.length > 0) {
      const inList = params.users.some((user) => {
        const split = user.split('#');
        const targetIdentifier = split[0];
        const targetDiscriminator = split.length > 1 ? Number(split[1]) : undefined;

        return targetIdentifier === username && (discriminator ? discriminator === targetDiscriminator : true);
      });

      if (!inList) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    if (guildId) {
      // Use the access token to fetch user information
      const userResponse = await axios.get('https://discord.com/api/users/@me/guilds/' + guildId + '/member', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      if (!(userResponse.data && userResponse.data.user.id === userId)) {
        return { success: false, error: 'User not in server' };
      }
    }

    return { success: true, toSet: [{ $set: { [`state.discord.${userId}`]: 1 } }] };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  }
};
