import { type BackendIntegrationPlugin } from './types';
import crypto from 'crypto';

export const IpRestrictionsDetails: BackendIntegrationPlugin<'ip'> = {
  pluginId: 'ip',
  defaultState: {
    ipsUsed: {}
  },
  metadata: {
    name: '',
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
