import { NumberType, UintRangeArray } from 'bitbadgesjs-sdk';
import { BackendIntegrationPlugin } from './types';

export const TransferTimesPluginDetails: BackendIntegrationPlugin<NumberType, 'transferTimes'> = {
  id: 'transferTimes',
  metadata: {
    name: 'Transfer Times',
    description: 'A transfer times challenge',
    image: 'https://bitbadges.s3.amazonaws.com/transfer_times.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    const times = UintRangeArray.From(publicParams.transferTimes);
    if (times.searchIfExists(Date.now())) {
      return { success: true };
    }

    return { success: false, error: 'Invalid transfer time' };
  },
  getPublicState: (currState) => {
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
