import { type BackendIntegrationPlugin } from './types';

export const RequiresSignaturePluginDetails: BackendIntegrationPlugin<'initiatedBy'> = {
  type: 'initiatedBy',
  metadata: {
    name: 'Requires Proof of Address',
    description: 'A proof of address challenge',
    image: 'https://bitbadges.s3.amazonaws.com/proof_of_address.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
    if (!adminInfo.cosmosAddress || !adminInfo.blockin) {
      return { success: false, error: 'Must be authenticated to claim' };
    }

    if (adminInfo.cosmosAddress !== context.cosmosAddress) {
      return { success: false, error: 'Invalid address. Provided address does not match the address of the signed in user.' };
    }

    return { success: true };
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
