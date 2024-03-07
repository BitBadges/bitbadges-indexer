import { NumberType } from 'bitbadgesjs-sdk';

import { BackendIntegrationPlugin } from './types';
import CryptoJS from 'crypto-js';

const { AES } = CryptoJS;
const symKey = process.env.SYM_KEY ?? '';
if (!symKey) {
  throw new Error('No symmetric key found');
}

export const PasswordPluginDetails: BackendIntegrationPlugin<NumberType, 'password'> = {
  id: 'password',
  metadata: {
    name: 'Password',
    description: 'A password challenge',
    image: 'https://bitbadges.s3.amazonaws.com/password.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    const password = privateParams.password;

    if (!privateParams.password || !customBody?.password) {
      return { success: false, error: 'Invalid configuration' };
    }

    if (password && customBody?.password && password == customBody?.password) {
      return { success: true };
    }

    return { success: false, error: 'Incorrect password' };
  },
  getPublicState: (currState) => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return {
      password: AES.encrypt(privateParams.password, symKey).toString()
    };
  },
  decryptPrivateParams: (privateParams) => {
    return {
      password: AES.decrypt(privateParams.password, symKey).toString(CryptoJS.enc.Utf8)
    };
  },
  getBlankPublicState: () => {
    return {};
  }
};
