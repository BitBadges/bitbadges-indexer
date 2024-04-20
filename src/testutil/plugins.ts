import {
  IntegrationPluginDetails,
  iUintRange,
  UintRangeArray,
  iAddressList,
  BlockinAssetConditionGroup,
  NumberType,
  ClaimApiCallInfo
} from 'bitbadgesjs-sdk';
import { AES } from 'crypto-js';
import { getPlugin } from '../integrations/types';

export const numUsesPlugin = (
  maxUses: number,
  maxUsesPerAddress: number,
  assignMethod: 'firstComeFirstServe' | 'codeIdx' = 'firstComeFirstServe'
): IntegrationPluginDetails<'numUses'> => {
  return {
    id: 'numUses',
    publicParams: {
      maxUses,
      maxUsesPerAddress,
      assignMethod
    },
    privateParams: {},
    publicState: getPlugin('numUses').getBlankPublicState()
  };
};

export const codesPlugin = (numCodes: number, seedCode: string): IntegrationPluginDetails<'codes'> => {
  return {
    id: 'codes',
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
    id: 'password',
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
    id: 'transferTimes',
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
    id: 'whitelist',
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

// export const greaterThanXBADGEBalancePlugin = (greaterThan: number): IntegrationPluginDetails<'greaterThanXBADGEBalance'> => {
//   return {
//     id: 'greaterThanXBADGEBalance',
//     publicParams: {
//       minBalance: greaterThan
//     },
//     privateParams: {},
//     publicState: {},
//     resetState: true
//   };
// };

export const discordPlugin = (usernames: string[]): IntegrationPluginDetails<'discord'> => {
  return {
    id: 'discord',
    publicParams: {
      hasPrivateList: false,
      users: usernames,
      maxUsesPerUser: 1
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const twitterPlugin = (usernames: string[]): IntegrationPluginDetails<'twitter'> => {
  return {
    id: 'twitter',
    publicParams: {
      hasPrivateList: false,
      users: usernames,
      maxUsesPerUser: 1
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const requiresProofOfAddressPlugin = (): IntegrationPluginDetails<'requiresProofOfAddress'> => {
  return {
    id: 'requiresProofOfAddress',
    publicParams: {},
    privateParams: {},
    publicState: {},
    resetState: true
  };
};

export const mustOwnBadgesPlugin = (ownershipReqs: BlockinAssetConditionGroup<NumberType>): IntegrationPluginDetails<'mustOwnBadges'> => {
  return {
    id: 'mustOwnBadges',
    publicParams: {
      ownershipRequirements: ownershipReqs
    },
    privateParams: {
      ownershipRequirements: { $and: [] }
    },
    publicState: {},
    resetState: true
  };
};
export const apiPlugin = (apiCalls: ClaimApiCallInfo[]): IntegrationPluginDetails<'api'> => {
  return {
    id: 'api',
    publicParams: {
      apiCalls
    },
    privateParams: {},
    publicState: {},
    resetState: true
  };
};
