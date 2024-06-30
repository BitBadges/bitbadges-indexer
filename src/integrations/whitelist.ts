import { AddressList, BitBadgesAddressList, convertToCosmosAddress } from 'bitbadgesjs-sdk';
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
    let userIdx = -1;

    if (params.listId) {
      const addressListRes = await mustGetAddressListsFromDB([{ listId: params.listId }], false);
      if (addressListRes.length === 0) {
        return { success: false, error: 'List not found' };
      }

      const addressList = new BitBadgesAddressList(addressListRes[0]);
      const idx = addressList.addresses.map((x) => convertToCosmosAddress(x)).indexOf(targetUser);
      if (idx === -1) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }

      if (addressList.whitelist) {
        userIdx = idx;
      }
    }

    if (params.list) {
      const addressList = new AddressList(params.list);
      const idx = addressList.addresses.map((x) => convertToCosmosAddress(x)).indexOf(targetUser);
      if (idx === -1) {
        return { success: false, error: 'User not in list of whitelisted users.' };
      }

      if (addressList.whitelist) {
        userIdx = idx;
      }
    }

    const instanceId = context.instanceId;
    const currNumUses = priorState?.addresses[id] || 0;
    if (maxUsesPerUser && maxUsesPerUser > 0 && currNumUses >= maxUsesPerUser) {
      return { success: false, error: 'User already exceeded max uses' };
    }

    return {
      success: true,
      toSet: [{ $set: { [`state.${instanceId}.addresses.${cosmosAddress}`]: currNumUses + 1 } }],
      claimNumber: context.isClaimNumberAssigner ? userIdx : undefined
    };
  },
  getPublicState: () => {
    return {};
  },
  getBlankPublicState() {
    return {};
  }
};
