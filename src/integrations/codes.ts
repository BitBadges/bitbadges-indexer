import { NumberType } from 'bitbadgesjs-sdk';
import CryptoJS from 'crypto-js';
import { BackendIntegrationPlugin } from './types';
import dotenv from 'dotenv';

dotenv.config();
const { AES, SHA256 } = CryptoJS;

export const generateCodesFromSeed = (seedCode: string, numCodes: number): string[] => {
  let currCode = seedCode;
  const codes = [];
  for (let i = 0; i < numCodes; i++) {
    currCode = SHA256(currCode + seedCode).toString();
    codes.push(currCode);
  }
  return codes;
};

const symKey = process.env.SYM_KEY ?? '';
if (!symKey) {
  throw new Error('No symmetric key found');
}

export const CodesPluginDetails: BackendIntegrationPlugin<NumberType, 'codes'> = {
  id: 'codes',
  metadata: {
    name: 'Codes',
    description: 'A code challenge',
    image: 'https://bitbadges.s3.amazonaws.com/codes.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {
    usedCodes: {}
  },
  encryptPrivateParams: (privateParams) => {
    return {
      codes: privateParams.codes.map((code) => AES.encrypt(code, symKey).toString()),
      seedCode: AES.encrypt(privateParams.seedCode, symKey).toString()
    };
  },
  decryptPrivateParams: (privateParams) => {
    return {
      codes: (privateParams.codes ?? []).map((code) => AES.decrypt(code, symKey).toString(CryptoJS.enc.Utf8)),
      seedCode: privateParams.seedCode ? AES.decrypt(privateParams.seedCode, symKey).toString(CryptoJS.enc.Utf8) : ''
    };
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    if (!customBody?.code) {
      return { success: false, error: 'Invalid code' };
    }

    if (priorState.usedCodes[customBody.code]) {
      return { success: false, error: 'Code already used' };
    }

    const maxUses = publicParams.numCodes;
    const seedCode = privateParams.seedCode;
    const codes = privateParams.seedCode ? generateCodesFromSeed(seedCode, maxUses) : privateParams.codes;
    if ((codes.length == 0 && !seedCode) || codes.length !== maxUses) {
      return { success: false, error: 'Invalid configuration' };
    }

    if (!codes.includes(customBody.code)) {
      return { success: false, error: 'Invalid code' };
    }

    return {
      success: true,
      toSet: [{ $set: { [`state.codes.usedCodes.${customBody.code}`]: 1 } }]
    };
  },
  getPublicState: (currState) => {
    return {
      usedCodes: Object.keys(currState.usedCodes)
    };
  },
  getBlankPublicState: () => {
    return {
      usedCodes: []
    };
  }
};
