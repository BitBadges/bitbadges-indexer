import { NumberType } from 'bitbadgesjs-sdk';
import { BackendIntegrationPlugin } from './types';
import axios from 'axios';

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
    const params = publicParams.users?.length ? publicParams : privateParams;

    if (!twitterInfo.username) {
      return { success: false, error: 'Invalid twitter details' };
    }

    if (priorState[twitterInfo.id]) {
      return { success: false, error: 'User already completed challenge' };
    }

    if (params.users && params.users.length > 0) {
      const inList = params.users.some((user) => user === twitterInfo.username);
      if (!inList) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    return { success: true, toSet: [{ $set: { [`state.twitter.${twitterInfo.id}`]: 1 } }] };
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

    if (priorState[userId]) {
      return { success: false, error: 'User already completed challenge' };
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
