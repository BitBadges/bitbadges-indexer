import { NumberType } from 'bitbadgesjs-sdk';
import { getAccountByAddress } from '../routes/users';
import { BackendIntegrationPlugin } from './types';

export const MinBalancePluginDetails: BackendIntegrationPlugin<NumberType, 'greaterThanXBADGEBalance'> = {
  id: 'greaterThanXBADGEBalance',
  metadata: {
    name: 'GreaterThanXBADGEBalance',
    description: 'A badge balance challenge',
    image: 'https://bitbadges.s3.amazonaws.com/greater_than_x_badge_balance.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    if (publicParams.minBalance !== undefined && publicParams.minBalance >= 0) {
      const account = await getAccountByAddress(undefined, context.cosmosAddress, { fetchBalance: true });
      if (account.balance && BigInt(account.balance.amount) >= BigInt(publicParams.minBalance)) {
        return { success: true };
      } else {
        return { success: false, error: 'Insufficient balance' };
      }
    }

    return { success: false, error: 'No min balance found' };
  },
  getPublicState: (currState) => {
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
