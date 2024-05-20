import { UintRangeArray } from 'bitbadgesjs-sdk';
import { type BackendIntegrationPlugin } from './types';

export const TransferTimesPluginDetails: BackendIntegrationPlugin<'transferTimes'> = {
  type: 'transferTimes',
  metadata: {
    name: 'Transfer Times',
    description: 'A transfer times challenge',
    image: 'https://bitbadges.s3.amazonaws.com/transfer_times.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: {},
  validateFunction: async (context, publicParams) => {
    const times = UintRangeArray.From(publicParams.transferTimes);
    if (times.searchIfExists(Date.now())) {
      return { success: true };
    }

    return { success: false, error: 'Invalid transfer time' };
  },
  getPublicState: () => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  getBlankPublicState: () => {
    return {};
  }
};
