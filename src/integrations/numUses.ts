import { type BackendIntegrationPlugin } from './types';

export const NumUsesDetails: BackendIntegrationPlugin<'numUses'> = {
  pluginId: 'numUses',
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
    const instanceId = context.instanceId;
    if (publicParams.maxUses && priorState.numUses >= publicParams.maxUses) {
      return { success: false, error: 'Overall max uses exceeded' };
    }

    const newNumUses = priorState.numUses + 1;

    return {
      success: true,
      claimNumber: context.isClaimNumberAssigner ? priorState.numUses : undefined,
      toSet: [
        {
          $set: {
            [`state.${instanceId}.numUses`]: newNumUses
          }
        }
      ]
    };
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
