import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth } from "bitbadgesjs-utils";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth_pb";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query_pb";
import * as bitbadgesQuery from "bitbadgesjs-proto/dist/proto/badges/query_pb";
import * as crypto from 'bitbadgesjs-proto/dist/proto/cosmos/crypto/ed25519/keys_pb';
import * as secp256k1 from 'bitbadgesjs-proto/dist/proto/cosmos/crypto/secp256k1/keys_pb';
import * as ethereum from 'bitbadgesjs-proto/dist/proto/ethereum/keys_pb';
import { convertToCosmosAddress, getChainForAddress, SupportedChain } from "bitbadgesjs-utils";
import { BadgeCollection } from "bitbadgesjs-proto/dist/proto/badges/collections_pb";
import { ApprovalsTracker, UserBalanceStore } from "bitbadgesjs-proto/dist/proto/badges/transfers_pb";
import { AddressMapping } from "bitbadgesjs-proto/dist/proto/badges/address_mappings_pb";

/**
 * The chain will return a similar structure but with a pub_key object and account_number field (see CosmosAccountResponse from bitbadgesjs-utils)
 * 
 * Here, we clean up the response to return a more conventional object for our purposes.
 */
export interface CleanedCosmosAccountInformation {
  publicKey: string
  sequence: string
  chain: SupportedChain
  cosmosAddress: string
  ethAddress: string
  accountNumber: string
}

const getAccountInfoToReturn = (accountPromise: Uint8Array, defaultAddress: string): CleanedCosmosAccountInformation => {
  //Native Cosmos SDK x/auth query for account information
  const accountInfo = accountQuery.QueryAccountResponse.fromBinary(accountPromise).account
  const accountInfoValue = accountInfo?.value;
  if (!accountInfoValue) throw new Error("Account not found");

  const accountObj = account.BaseAccount.fromBinary(accountInfoValue);
  let pubKeyStr = '';
  let chain = getChainForAddress(defaultAddress);
  if (accountObj.pubKey?.typeUrl) {
    if (accountObj.pubKey.typeUrl === '/ethereum.PubKey') {
      chain = SupportedChain.ETH
    } else if (accountObj.pubKey.typeUrl === '/cosmos.crypto.secp256k1.PubKey') {
      chain = SupportedChain.COSMOS
    } else if (accountObj.pubKey.typeUrl === '/cosmos.crypto.ed25519.PubKey') {
      chain = SupportedChain.SOLANA
    }
  }

  if (accountObj.pubKey?.value && chain == SupportedChain.ETH) {
    const pub_key = ethereum.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pub_key).toString('base64');
  } else if (accountObj.pubKey?.value && chain == SupportedChain.SOLANA) {
    const pub_key = crypto.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pub_key).toString('base64');
  } else if (accountObj.pubKey?.value && chain == SupportedChain.COSMOS) {
    const pub_key = secp256k1.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pub_key).toString('base64');
  }

  return {
    publicKey: pubKeyStr,
    sequence: accountObj.sequence ? accountObj.sequence.toString() : "0",
    accountNumber: accountObj.accountNumber !== undefined && accountObj.accountNumber >= 0 ? accountObj.accountNumber.toString() : "0",
    chain,
    ethAddress: accountObj.address ? cosmosToEth(accountObj.address) : '',
    // solAddress: '',
    cosmosAddress: accountObj.address ? convertToCosmosAddress(accountObj.address) : '',
  }
}

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>
    readonly getCollection: (collectionId: string) => Promise<BadgeCollection | undefined>
    readonly getBalance: (collectionId: string, address: string) => Promise<UserBalanceStore | undefined>
    readonly getAddressMapping: (mappingId: string) => Promise<AddressMapping | undefined>
    readonly getApprovalsTracker: (collectionId: string, approvalLevel: string, approverAddress: string, amountTrackerId: string, trackerType: string, approvedAddress: string) => Promise<ApprovalsTracker | undefined>
    readonly getNumUsedForMerkleChallenge: (collectionId: string, approvalLevel: string, approverAddress: string, challengeTrackerId: string, leafIndex: string) => Promise<string | undefined>
  }
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
  const rpc = createProtobufRpcClient(base)

  return {
    badges: {
      getAccountInfo: async (address: string): Promise<CleanedCosmosAccountInformation> => {
        const cosmosAddress = convertToCosmosAddress(address);
        try {
          //Native Cosmos SDK x/auth query for account information

          const accountData = new accountQuery.QueryAccountRequest({ address: cosmosAddress }).toBinary();
          const accountPromise = await rpc.request(
            'cosmos.auth.v1beta1.Query',
            'Account',
            accountData
          )

          return getAccountInfoToReturn(accountPromise, address);
        } catch (error) {
          return {
            ethAddress: cosmosToEth(convertToCosmosAddress(address)),
            sequence: "0",
            accountNumber: "-1",
            cosmosAddress: convertToCosmosAddress(address),
            // solAddress: '',
            chain: getChainForAddress(address),
            publicKey: '',
          }
        }
      },

      getCollection: async (collectionId: string) => {
        const collectionData = new bitbadgesQuery.QueryGetCollectionRequest({ collectionId: collectionId }).toBinary();
        const collectionPromise = await rpc.request(
          'badges.Query',
          'GetCollection',
          collectionData
        )

        return bitbadgesQuery.QueryGetCollectionResponse.fromBinary(collectionPromise).collection;
      },

      getBalance: async (collectionId: string, address: string) => {
        const balanceData = new bitbadgesQuery.QueryGetBalanceRequest({ collectionId: collectionId, address: address }).toBinary();
        const balancePromise = await rpc.request(
          'badges.Query',
          'GetBalance',
          balanceData
        )

        return bitbadgesQuery.QueryGetBalanceResponse.fromBinary(balancePromise).balance;
      },

      getAddressMapping: async (mappingId: string) => {
        const addressMappingData = new bitbadgesQuery.QueryGetAddressMappingRequest({ mappingId: mappingId }).toBinary();
        const addressMappingPromise = await rpc.request(
          'badges.Query',
          'GetAddressMapping',
          addressMappingData
        )

        return bitbadgesQuery.QueryGetAddressMappingResponse.fromBinary(addressMappingPromise).mapping;
      },

      getApprovalsTracker: async (collectionId: string, approvalLevel: string, approverAddress: string, amountTrackerId: string, trackerType: string, approvedAddress: string) => {
        const approvalsTrackerData = new bitbadgesQuery.QueryGetApprovalsTrackerRequest({
          collectionId: collectionId ?? "",
          approvalLevel: approvalLevel ?? "",
          approverAddress: approverAddress ?? "",
          amountTrackerId: amountTrackerId ?? "",
          trackerType: trackerType ?? "",
          approvedAddress: approvedAddress ?? ""
        }).toBinary();
        const approvalsTrackerPromise = await rpc.request(
          'badges.Query',
          'GetApprovalsTracker',
          approvalsTrackerData
        )

        return bitbadgesQuery.QueryGetApprovalsTrackerResponse.fromBinary(approvalsTrackerPromise).tracker;
      },

      getNumUsedForMerkleChallenge: async (collectionId: string, approvalLevel: string, approverAddress: string, challengeTrackerId: string, leafIndex: string) => {
        const numUsedForMerkleChallengeData = new bitbadgesQuery.QueryGetNumUsedForMerkleChallengeRequest({
          collectionId: collectionId,
          approvalLevel: approvalLevel,
          approverAddress: approverAddress,
          challengeTrackerId: challengeTrackerId,
          leafIndex: leafIndex
        }).toBinary();

        const numUsedForMerkleChallengePromise = await rpc.request(
          'badges.Query',
          'GetNumUsedForMerkleChallenge',
          numUsedForMerkleChallengeData
        )

        return bitbadgesQuery.QueryGetNumUsedForMerkleChallengeResponse.fromBinary(numUsedForMerkleChallengePromise).numUsed;
      }
    },
  }
}