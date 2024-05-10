import { AddressList, BitBadgesAddressList } from 'bitbadgesjs-sdk';
import { getAddressListsFromDB } from '../routes/utils';
import { type BackendIntegrationPlugin } from './types';

export const WhitelistPluginDetails: BackendIntegrationPlugin<'whitelist'> = {
  id: 'whitelist',
  metadata: {
    name: 'Whitelist',
    description: 'A whitelist challenge',
    image: 'https://bitbadges.s3.amazonaws.com/whitelist.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams) => {
    const targetUser = context.cosmosAddress;
    const params = publicParams.list || publicParams.listId ? publicParams : privateParams;

    if (params.listId) {
      const addressListRes = await getAddressListsFromDB([{ listId: params.listId }], false);
      if (addressListRes.length === 0) {
        return { success: false, error: 'List not found' };
      }

      const addressList = new BitBadgesAddressList(addressListRes[0]);
      if (!addressList.checkAddress(targetUser)) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    if (params.list) {
      const addressList = new AddressList(params.list);
      if (!addressList.checkAddress(targetUser)) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }
    }

    return { success: true };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
