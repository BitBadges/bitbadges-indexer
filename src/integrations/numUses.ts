import { type BackendIntegrationPlugin } from './types';

export const NumUsesDetails: BackendIntegrationPlugin<'numUses'> = {
  type: 'numUses',
  defaultState: {
    claimedUsers: {},
    numUses: 0
  },
  metadata: {
    name: 'One Time Use',
    description: 'A one time use code challenge',
    image: 'https://bitbadges.s3.amazonaws.com/one_time_use.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    const pluginId = context.pluginId;
    if (publicParams.maxUses && priorState.numUses >= publicParams.maxUses) {
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

    const assignMethod = publicParams.assignMethod;
    if (assignMethod === 'firstComeFirstServe' || !assignMethod) {
      // defaults to this
      return {
        success: true,
        toSet: [
          {
            $set: {
              [`state.${pluginId}.numUses`]: { $add: [`$state.${pluginId}.numUses`, 1] }
            }
          },
          {
            $set: {
              [`state.${pluginId}.claimedUsers.${cosmosAddress}`]: {
                $concatArrays: [claimedUsers[cosmosAddress] ?? [], [{ $subtract: [`$state.${pluginId}.numUses`, 1] }]]
              }
            }
          }
        ]
      };
    } else if (assignMethod === 'codeIdx') {
      return {
        success: true,
        toSet: [
          {
            $set: {
              [`state.${pluginId}.numUses`]: { $add: [`$state.${pluginId}.numUses`, 1] }
            }
          }
        ]
      };
    } else {
      throw new Error('Invalid assignMethod');
    }
  },
  getPublicState: (currState) => {
    return {
      claimedUsers: currState.claimedUsers,
      numUses: currState.numUses
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
