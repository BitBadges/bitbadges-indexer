import { AddressList, BitBadgesAddressList, type NumberType } from 'bitbadgesjs-sdk';
import { getAddressListsFromDB } from '../routes/utils';
import { type BackendIntegrationPlugin } from './types';

export const WhitelistPluginDetails: BackendIntegrationPlugin<NumberType, 'whitelist'> = {
  id: 'whitelist',
  metadata: {
    name: 'Whitelist',
    description: 'A whitelist challenge',
    image: 'https://bitbadges.s3.amazonaws.com/whitelist.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState) => {
    const targetUser = context.cosmosAddress;
    const params = publicParams.list || publicParams.listId ? publicParams : privateParams;

    if (params.listId) {
      const addressListRes = await getAddressListsFromDB([{ listId: params.listId }], false);
      if (addressListRes.length === 0) {
        return { success: false, error: 'List not found' };
      }

      const addressList = new BitBadgesAddressList(addressListRes[0]);
      if (!addressList.checkAddress(context.cosmosAddress)) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    if (params.list) {
      const addressList = new AddressList(params.list);
      if (!addressList.checkAddress(context.cosmosAddress)) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    return { success: true, toSet: [{ $set: { [`state.whitelist.${targetUser}`]: 1 } }] };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
