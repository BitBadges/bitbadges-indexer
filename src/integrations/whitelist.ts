import { AddressList, BitBadgesAddressList } from 'bitbadgesjs-sdk';
import { mustGetAddressListsFromDB } from '../routes/utils';
import { type BackendIntegrationPlugin } from './types';

export const WhitelistPluginDetails: BackendIntegrationPlugin<'whitelist'> = {
  pluginId: 'whitelist',
  metadata: {
    name: 'Whitelist',
    description: 'A whitelist challenge',
    image: 'https://bitbadges.s3.amazonaws.com/whitelist.png',
    createdBy: 'BitBadges',
    stateless: false,
    scoped: true,
    duplicatesAllowed: false
  },
  defaultState: {
    addresses: {}
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    const targetUser = context.cosmosAddress;
    const params = publicParams.list || publicParams.listId ? publicParams : privateParams;

    const maxUsesPerUser = publicParams.maxUsesPerAddress;
    const cosmosAddress = context.cosmosAddress;
    const id = cosmosAddress;

    if (params.listId) {
      const addressListRes = await mustGetAddressListsFromDB([{ listId: params.listId }], false);
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

    const instanceId = context.instanceId;
    const currNumUses = priorState?.addresses[id] || 0;
    if (maxUsesPerUser && maxUsesPerUser > 0 && currNumUses >= maxUsesPerUser) {
      return { success: false, error: 'User already exceeded max uses' };
    }

    return {
      success: true,
      toSet: [{ $set: { [`state.${instanceId}.addresses.${cosmosAddress}`]: currNumUses + 1 } }]
    };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
