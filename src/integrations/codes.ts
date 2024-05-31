import CryptoJS from 'crypto-js';
import dotenv from 'dotenv';
import { type BackendIntegrationPlugin } from './types';

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

export interface Setter {
  $set: object;
}

export const CodesPluginDetails: BackendIntegrationPlugin<'codes'> = {
  type: 'codes',
  metadata: {
    name: 'Codes',
    description: 'A code challenge',
    image: 'https://bitbadges.s3.amazonaws.com/codes.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: false,
    duplicatesAllowed: true
  },
  defaultState: {
    usedCodeIndices: {}
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
    const instanceId = context.instanceId;
    if (!customBody?.code) {
      return { success: false, error: 'Invalid code in body provided.' };
    }

    const maxUses = publicParams.numCodes;
    const seedCode = privateParams.seedCode;
    const codes = privateParams.seedCode ? generateCodesFromSeed(seedCode, maxUses) : privateParams.codes;
    if ((codes.length == 0 && !seedCode) || codes.length !== maxUses) {
      return { success: false, error: 'Invalid configuration' };
    }

    if (!codes.includes(customBody.code)) {
      return { success: false, error: 'Invalid code. Not found in list of codes.' };
    }

    const codeIdx = codes.indexOf(customBody.code);
    if (codeIdx === -1) {
      return { success: false, error: 'Invalid code. Not found in list of codes.' };
    }

    if (priorState.usedCodeIndices[codeIdx]) {
      return { success: false, error: 'Code already used' };
    }

    const toSet: Setter[] = [{ $set: { [`state.${instanceId}.usedCodeIndices.${codeIdx}`]: 1 } }];
    return {
      success: true,
      toSet,
      claimNumber: context.isClaimNumberAssigner ? codeIdx : undefined
    };
  },
  getPublicState: (currState) => {
    return {
      usedCodeIndices: Object.keys(currState.usedCodeIndices)
    };
  },
  getBlankPublicState: () => {
    return {
      usedCodeIndices: []
    };
  }
};
