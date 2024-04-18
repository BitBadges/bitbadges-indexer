import { createProtobufRpcClient, type QueryClient } from '@cosmjs/stargate';
import { convertToEthAddress, convertToBtcAddress, convertToCosmosAddress, getChainForAddress, SupportedChain, ValueStore } from 'bitbadgesjs-sdk';
import * as account from 'bitbadgesjs-sdk/dist/proto/cosmos/auth/v1beta1/auth_pb';
import * as accountQuery from 'bitbadgesjs-sdk/dist/proto/cosmos/auth/v1beta1/query_pb';
import * as bitbadgesQuery from 'bitbadgesjs-sdk/dist/proto/badges/query_pb';
import * as mapsQuery from 'bitbadgesjs-sdk/dist/proto/maps/query_pb';
import type * as proto from 'bitbadgesjs-sdk/dist/proto/';
import * as crypto from 'bitbadgesjs-sdk/dist/proto/cosmos/crypto/ed25519/keys_pb';
import * as secp256k1 from 'bitbadgesjs-sdk/dist/proto/cosmos/crypto/secp256k1/keys_pb';
import * as ethereum from 'bitbadgesjs-sdk/dist/proto/ethereum/ethsecp256k1/keys_pb';
import { type BadgeCollection } from 'bitbadgesjs-sdk/dist/proto/badges/collections_pb';
import { type ApprovalTracker, type UserBalanceStore } from 'bitbadgesjs-sdk/dist/proto/badges/transfers_pb';
import { type AddressList } from 'bitbadgesjs-sdk/dist/proto/badges/address_lists_pb';

/**
 * The chain will return a similar structure but with a pub_key object and account_number field (see CosmosAccountResponse from bitbadgesjs-sdk)
 *
 * Here, we clean up the response to return a more conventional object for our purposes.
 */
export interface CleanedCosmosAccountInformation {
  publicKey: string;
  sequence: string;
  chain: SupportedChain;
  pubKeyType: string;
  cosmosAddress: string;
  ethAddress: string;
  btcAddress: string;
  accountNumber: string;
}

const getAccountInfoToReturn = (accountPromise: Uint8Array, defaultAddress: string): CleanedCosmosAccountInformation => {
  // Native Cosmos SDK x/auth query for account information
  const accountInfo = accountQuery.QueryAccountResponse.fromBinary(accountPromise).account;
  const accountInfoValue = accountInfo?.value;
  if (!accountInfoValue) throw new Error('Account not found');

  const accountObj = account.BaseAccount.fromBinary(accountInfoValue);
  let pubKeyStr = '';
  let chain = getChainForAddress(defaultAddress);
  let pubKeyType = '';
  if (accountObj.pubKey?.typeUrl) {
    if (accountObj.pubKey.typeUrl === '/ethereum.PubKey') {
      chain = SupportedChain.ETH;
      pubKeyType = 'ethsecp256k1';
    } else if (accountObj.pubKey.typeUrl === '/cosmos.crypto.secp256k1.PubKey') {
      // chain can be Cosmos or BTC if secp so we default to whatever was requested
      pubKeyType = 'secp256k1';
    } else if (accountObj.pubKey.typeUrl === '/cosmos.crypto.ed25519.PubKey') {
      chain = SupportedChain.SOLANA;
      pubKeyType = 'ed25519';
    }
  }

  if (accountObj.pubKey?.value && chain === SupportedChain.ETH) {
    const pubKey = ethereum.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pubKey).toString('base64');
  } else if (accountObj.pubKey?.value && chain === SupportedChain.SOLANA) {
    const pubKey = crypto.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pubKey).toString('base64');
  } else if (accountObj.pubKey?.value) {
    /// && chain == SupportedChain.COSMOS
    const pubKey = secp256k1.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pubKey).toString('base64');
  }

  return {
    publicKey: pubKeyStr,
    sequence: accountObj.sequence ? accountObj.sequence.toString() : '0',
    accountNumber: accountObj.accountNumber !== undefined && accountObj.accountNumber >= 0 ? accountObj.accountNumber.toString() : '0',
    chain,
    ethAddress: accountObj.address ? convertToEthAddress(accountObj.address) : '',
    btcAddress: accountObj.address ? convertToBtcAddress(accountObj.address) : '',
    pubKeyType,
    cosmosAddress: accountObj.address ? convertToCosmosAddress(accountObj.address) : ''
  };
};

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>;
    readonly getCollection: (collectionId: string) => Promise<BadgeCollection | undefined>;
    readonly getBalance: (collectionId: string, address: string) => Promise<UserBalanceStore | undefined>;
    readonly getAddressList: (listId: string) => Promise<AddressList | undefined>;
    readonly getApprovalTracker: (
      collectionId: string,
      approvalLevel: string,
      approvalId: string,
      approverAddress: string,
      amountTrackerId: string,
      trackerType: string,
      approvedAddress: string
    ) => Promise<ApprovalTracker | undefined>;
    readonly getChallengeTracker: (
      collectionId: string,
      approvalId: string,
      approvalLevel: string,
      approverAddress: string,
      challengeTrackerId: string,
      leafIndex: string
    ) => Promise<string | undefined>;
  };

  readonly maps: {
    readonly getMap: (mapId: string) => Promise<proto.maps.Map | undefined>;
    readonly getMapValue: (mapId: string, key: string) => Promise<ValueStore | undefined>;
  };
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
  const rpc = createProtobufRpcClient(base);

  return {
    maps: {
      getMap: async (mapId: string): Promise<proto.maps.Map | undefined> => {
        const mapData = new mapsQuery.QueryGetMapRequest({ mapId }).toBinary();
        const mapPromise = await rpc.request('maps.Query', 'Map', mapData);

        const map = mapsQuery.QueryGetMapResponse.fromBinary(mapPromise).map;
        return map;
      },

      getMapValue: async (mapId: string, key: string): Promise<ValueStore | undefined> => {
        const mapValueData = new mapsQuery.QueryGetMapValueRequest({ mapId, key }).toBinary();
        const mapValuePromise = await rpc.request('maps.Query', 'MapValue', mapValueData);

        const res = mapsQuery.QueryGetMapValueResponse.fromBinary(mapValuePromise).value;
        return res ? new ValueStore({ ...res }) : undefined;
      }
    },
    badges: {
      getAccountInfo: async (address: string): Promise<CleanedCosmosAccountInformation> => {
        const cosmosAddress = convertToCosmosAddress(address);
        try {
          // Native Cosmos SDK x/auth query for account information

          const accountData = new accountQuery.QueryAccountRequest({
            address: cosmosAddress
          }).toBinary();
          const accountPromise = await rpc.request('cosmos.auth.v1beta1.Query', 'Account', accountData);

          return getAccountInfoToReturn(accountPromise, address);
        } catch (error) {
          return {
            ethAddress: convertToEthAddress(convertToCosmosAddress(address)),
            btcAddress: convertToBtcAddress(convertToCosmosAddress(address)),
            sequence: '-1',
            accountNumber: '-1',
            pubKeyType: '',
            cosmosAddress: convertToCosmosAddress(address),
            // solAddress: '',
            chain: getChainForAddress(address),
            publicKey: ''
          };
        }
      },

      getCollection: async (collectionId: string) => {
        const collectionData = new bitbadgesQuery.QueryGetCollectionRequest({
          collectionId
        }).toBinary();
        const collectionPromise = await rpc.request('badges.Query', 'GetCollection', collectionData);

        return bitbadgesQuery.QueryGetCollectionResponse.fromBinary(collectionPromise).collection;
      },

      getBalance: async (collectionId: string, address: string) => {
        const balanceData = new bitbadgesQuery.QueryGetBalanceRequest({
          collectionId,
          address
        }).toBinary();
        const balancePromise = await rpc.request('badges.Query', 'GetBalance', balanceData);

        return bitbadgesQuery.QueryGetBalanceResponse.fromBinary(balancePromise).balance;
      },

      getAddressList: async (listId: string) => {
        const addressListData = new bitbadgesQuery.QueryGetAddressListRequest({
          listId
        }).toBinary();
        const addressListPromise = await rpc.request('badges.Query', 'GetAddressList', addressListData);

        return bitbadgesQuery.QueryGetAddressListResponse.fromBinary(addressListPromise).list;
      },

      getApprovalTracker: async (
        collectionId: string,
        approvalLevel: string,
        approvalId: string,
        approverAddress: string,
        amountTrackerId: string,
        trackerType: string,
        approvedAddress: string
      ) => {
        const approvalTrackerData = new bitbadgesQuery.QueryGetApprovalTrackerRequest({
          collectionId: collectionId ?? '',
          approvalId: approvalId ?? '',
          approvalLevel: approvalLevel ?? '',
          approverAddress: approverAddress ?? '',
          amountTrackerId: amountTrackerId ?? '',
          trackerType: trackerType ?? '',
          approvedAddress: approvedAddress ?? ''
        }).toBinary();
        const approvalTrackerPromise = await rpc.request('badges.Query', 'GetApprovalTracker', approvalTrackerData);

        return bitbadgesQuery.QueryGetApprovalTrackerResponse.fromBinary(approvalTrackerPromise).tracker;
      },

      getChallengeTracker: async (
        collectionId: string,
        approvalId: string,
        approvalLevel: string,
        approverAddress: string,
        challengeTrackerId: string,
        leafIndex: string
      ) => {
        const challengeTrackerData = new bitbadgesQuery.QueryGetChallengeTrackerRequest({
          collectionId,
          approvalLevel,
          approverAddress,
          approvalId,
          challengeTrackerId,
          leafIndex
        }).toBinary();

        const challengeTrackerPromise = await rpc.request('badges.Query', 'GetChallengeTracker', challengeTrackerData);
        return bitbadgesQuery.QueryGetChallengeTrackerResponse.fromBinary(challengeTrackerPromise).numUsed;
      }
    }
  };
}
