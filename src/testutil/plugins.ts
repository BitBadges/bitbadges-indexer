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

export const getPluginStateByType = (doc: iClaimBuilderDoc<NumberType>, pluginId: ClaimIntegrationPluginType): any => {
  const id = getFirstMatchForPluginType(pluginId, doc.plugins ?? [])?.instanceId ?? '';
  return doc.state[id];
};

export const getPluginIdByType = (doc: iClaimBuilderDoc<NumberType>, pluginId: ClaimIntegrationPluginType): string => {
  return getFirstMatchForPluginType(pluginId, doc.plugins ?? [])?.instanceId ?? '';
};

export const numUsesPlugin = (
  maxUses: number,
  maxUsesPerAddress: number,
  assignMethod: 'firstComeFirstServe' | 'codeIdx' = 'firstComeFirstServe'
): IntegrationPluginDetails<'numUses'> => {
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'numUses',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'codes',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'password',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'transferTimes',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'whitelist',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'discord',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'twitter',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'initiatedBy',
    publicParams: {},
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const mustOwnBadgesPlugin = (ownershipReqs: BlockinAssetConditionGroup<NumberType>): IntegrationPluginDetails<'must-own-badges'> => {
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'must-own-badges',
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
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: customPluginId,
    publicParams: publicParams,
    privateParams: privateParams,
    publicState: {},
    resetState: true
  };
};
