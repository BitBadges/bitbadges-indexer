import { type BackendIntegrationPlugin } from './types';

export const PasswordPluginDetails: BackendIntegrationPlugin<'password'> = {
  pluginId: 'password',
  metadata: {
    name: 'Password',
    description: 'A password challenge',
    image: 'https://bitbadges.s3.amazonaws.com/password.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody) => {
    const password = privateParams.password;

    if (!privateParams.password || !customBody?.password) {
      return { success: false, error: 'Invalid configuration' };
    }

    if (password && customBody?.password && password == customBody?.password) {
      return { success: true };
    }

    return { success: false, error: 'Incorrect password' };
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
