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
import { getCorePlugin, getFirstMatchForPluginType } from '../integrations/types';

export const getPluginStateByType = (doc: iClaimBuilderDoc<NumberType>, pluginId: ClaimIntegrationPluginType): any => {
  const id = getFirstMatchForPluginType(pluginId, doc.plugins ?? [])?.instanceId ?? '';
  return doc.state[id];
};

export const getPluginIdByType = (doc: iClaimBuilderDoc<NumberType>, pluginId: ClaimIntegrationPluginType): string => {
  return getFirstMatchForPluginType(pluginId, doc.plugins ?? [])?.instanceId ?? '';
};

export const numUsesPlugin = (maxUses: number): IntegrationPluginDetails<'numUses'> => {
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'numUses',
    publicParams: {
      maxUses
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
      seedCode: seedCode
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
      password: password
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

//for legacy purposes
export const maxUsesPerAddressPlugin = (maxUsesPerAddress: number): IntegrationPluginDetails<'whitelist'> => {
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'whitelist',
    publicParams: {
      maxUsesPerAddress
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

export const discordPlugin = (usernames: string[], maxUsesPerUser?: number): IntegrationPluginDetails<'discord'> => {
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: 'discord',
    publicParams: {
      hasPrivateList: false,
      maxUsesPerUser: maxUsesPerUser ?? 1
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
  return {
    instanceId: crypto.randomBytes(32).toString('hex'),
    pluginId: customPluginId,
    publicParams: publicParams,
    privateParams: privateParams,
    publicState: {},
    resetState: true
  };
};
