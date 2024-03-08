import { NumberType } from 'bitbadgesjs-sdk';
import { BackendIntegrationPlugin } from './types';

export const NumUsesDetails: BackendIntegrationPlugin<NumberType, 'numUses'> = {
  id: 'numUses',
  defaultState: {
    claimedUsers: {},
    currCode: 0
  },
  metadata: {
    name: 'One Time Use',
    description: 'A one time use code challenge',
    image: 'https://bitbadges.s3.amazonaws.com/one_time_use.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    if (publicParams.maxUses && priorState.currCode >= publicParams.maxUses) {
      return { success: false, error: 'Overall max uses exceeded' };
    }

    const maxUsesPerAddress = publicParams.maxUsesPerAddress;

    const claimedUsers = priorState?.claimedUsers ? priorState.claimedUsers : {};
    const cosmosAddress = context.cosmosAddress;
    const prevUsedIdxs = claimedUsers[cosmosAddress] ?? [];

    if (maxUsesPerAddress) {
      if (prevUsedIdxs.length >= maxUsesPerAddress) {
        return { success: false, error: 'Exceeded max uses for this address' };
      }
    }

    return {
      success: true,
      toSet: [
        {
          $set: {
            ['state.numUses.currCode']: { $add: ['$state.numUses.currCode', 1] }
          }
        },
        {
          $set: {
            [`state.numUses.claimedUsers.${cosmosAddress}`]: {
              $concatArrays: [claimedUsers[cosmosAddress] ?? [], [{ $subtract: ['$state.numUses.currCode', 1] }]]
            }
          }
        }
      ]
    };
  },
  getPublicState: (currState) => {
    return {
      claimedUsers: currState.claimedUsers,
      numUses: currState.currCode
    };
  },
  getBlankPublicState: () => {
    return {
      claimedUsers: {},
      numUses: 0
    };
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  }
};
