import { type BackendIntegrationPlugin } from './types';

export const HaltedPluginDetails: BackendIntegrationPlugin<'halt'> = {
  pluginId: 'halt',
  metadata: {
    name: 'Halt Status',
    description: '',
    image: '',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    return { success: false, error: 'Claim halted' };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
