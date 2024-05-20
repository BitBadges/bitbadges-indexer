import {
  BlockinAssetConditionGroup,
  ClaimIntegrationPluginType,
  IntegrationPluginDetails,
  NumberType,
  UintRangeArray,
  iAddressList,
  iClaimBuilderDoc,
  iUintRange
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { AES } from 'crypto-js';
import { getCorePlugin, getFirstMatchForPluginType } from '../integrations/types';

export const getPluginStateByType = (doc: iClaimBuilderDoc<NumberType>, type: ClaimIntegrationPluginType): any => {
  const id = getFirstMatchForPluginType(type, doc.plugins ?? [])?.id ?? '';
  return doc.state[id];
};

export const getPluginIdByType = (doc: iClaimBuilderDoc<NumberType>, type: ClaimIntegrationPluginType): string => {
  return getFirstMatchForPluginType(type, doc.plugins ?? [])?.id ?? '';
};

export const numUsesPlugin = (
  maxUses: number,
  maxUsesPerAddress: number,
  assignMethod: 'firstComeFirstServe' | 'codeIdx' = 'firstComeFirstServe'
): IntegrationPluginDetails<'numUses'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'numUses',
    publicParams: {
      maxUses,
      maxUsesPerAddress,
      assignMethod
    },
    privateParams: {},
    publicState: getCorePlugin('numUses').getBlankPublicState()
  };
};

export const codesPlugin = (numCodes: number, seedCode: string): IntegrationPluginDetails<'codes'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'codes',
    publicParams: {
      numCodes
    },
    privateParams: {
      codes: [],
      seedCode: AES.encrypt(seedCode, process.env.SYM_KEY ?? '').toString()
    },
    publicState: {
      usedCodeIndices: []
    },
    resetState: true
  };
};

export const passwordPlugin = (password: string): IntegrationPluginDetails<'password'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'password',
    publicParams: {},
    privateParams: {
      password: AES.encrypt(password, process.env.SYM_KEY ?? '').toString()
    },
    publicState: {},
    resetState: true
  };
};

export const transferTimesPlugin = (transferTimes: iUintRange<number>): IntegrationPluginDetails<'transferTimes'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'transferTimes',
    publicParams: {
      transferTimes: UintRangeArray.From(transferTimes)
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const whitelistPlugin = (privateMode: boolean, list?: iAddressList, listId?: string): IntegrationPluginDetails<'whitelist'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'whitelist',
    publicParams: privateMode
      ? {}
      : {
          list,
          listId
        },
    privateParams: privateMode
      ? {
          list,
          listId
        }
      : {},
    publicState: {},
    resetState: true
  };
};

export const discordPlugin = (usernames: string[]): IntegrationPluginDetails<'discord'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'discord',
    publicParams: {
      hasPrivateList: false,
      maxUsesPerUser: 1
    },
    privateParams: {
      usernames: usernames
    },
    publicState: {},
    resetState: true
  };
};

export const twitterPlugin = (usernames: string[]): IntegrationPluginDetails<'twitter'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'twitter',
    publicParams: {
      hasPrivateList: false,
      maxUsesPerUser: 1
    },
    privateParams: {
      usernames: usernames
    },
    publicState: {},
    resetState: true
  };
};

export const initiatedByPlugin = (): IntegrationPluginDetails<'initiatedBy'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'initiatedBy',
    publicParams: {},
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const mustOwnBadgesPlugin = (ownershipReqs: BlockinAssetConditionGroup<NumberType>): IntegrationPluginDetails<'must-own-badges'> => {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: 'must-own-badges',
    publicParams: {
      ownershipRequirements: ownershipReqs
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const apiPlugin = (customPluginId: string, publicParams: any, privateParams: any): IntegrationPluginDetails<any> => {
  // const doc = await mustGetFromDB(PluginModel, customPluginId);

  return {
    id: crypto.randomBytes(32).toString('hex'),
    type: customPluginId,
    publicParams: publicParams,
    privateParams: privateParams,
    publicState: {},
    resetState: true
  };
};
