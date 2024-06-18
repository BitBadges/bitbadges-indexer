import axios from 'axios';
import { type BackendIntegrationPlugin } from './types';
import crypto from 'crypto';

export const IpRestrictionsDetails: BackendIntegrationPlugin<'ip'> = {
  pluginId: 'ip',
  defaultState: {
    ipsUsed: {}
  },
  metadata: {
    name: 'IP Restrictions',
    description: '',
    image: '',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
    const maxUsesPerIp = publicParams.maxUsesPerIp;
    const currIp = adminInfo.ip;
    if (!currIp) {
      return { success: false, error: 'No IP address found.' };
    }

    const hashedIp = crypto.createHash('sha256').update(currIp).digest('hex');

    const instanceId = context.instanceId;
    const currNumUses = priorState?.ipsUsed[hashedIp] || 0;
    if (maxUsesPerIp && maxUsesPerIp > 0 && currNumUses >= maxUsesPerIp) {
      return { success: false, error: 'User already exceeded max uses for this IP address.' };
    }

    return {
      success: true,
      toSet: [{ $set: { [`state.${instanceId}.ipsUsed.${hashedIp}`]: currNumUses + 1 } }]
    };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  }
};

export const GeolocationRestrictionsDetails: BackendIntegrationPlugin<'geolocation'> = {
  pluginId: 'geolocation',
  defaultState: {},
  metadata: {
    name: 'Geolocation Restrictions',
    description: '',
    image: '',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true,
    duplicatesAllowed: false
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
    // Using IPstack
    const ip = adminInfo.ip;
    const resp = await axios.get('http://api.ipstack.com/' + ip + '?access_key=' + process.env.IPSTACK_API_KEY);
    if (!resp.data?.latitude || !resp.data?.longitude) {
      return { success: false, error: 'Could not retrieve geolocation data.' };
    }

    const { pindrop, allowedCountryCodes, disallowedCountryCodes } = publicParams;
    if (pindrop) {
      const { latitude, longitude, radius } = pindrop;
      if (resp.data.latitude && resp.data.longitude) {
        const distance = Math.sqrt((latitude - resp.data.latitude) ** 2 + (longitude - resp.data.longitude) ** 2);
        if (distance > radius) {
          return { success: false, error: 'User is not within the allowed radius.' };
        }
      }
    }

    if (allowedCountryCodes && allowedCountryCodes.length > 0) {
      if (!allowedCountryCodes.includes(resp.data.country_code)) {
        return { success: false, error: 'User is not in an allowed country.' };
      }
    }

    if (disallowedCountryCodes && disallowedCountryCodes.length > 0) {
      if (disallowedCountryCodes.includes(resp.data.country_code)) {
        return { success: false, error: 'User is in a disallowed country.' };
      }
    }

    return {
      success: true
    };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState: () => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  }
};
