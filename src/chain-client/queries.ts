import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth, cosmosToBtc } from "bitbadgesjs-utils";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth_pb";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query_pb";
import * as bitbadgesQuery from "bitbadgesjs-proto/dist/proto/badges/query_pb";
import * as protocolsQuery from "bitbadgesjs-proto/dist/proto/protocols/query_pb";
import * as crypto from 'bitbadgesjs-proto/dist/proto/cosmos/crypto/ed25519/keys_pb';
import * as secp256k1 from 'bitbadgesjs-proto/dist/proto/cosmos/crypto/secp256k1/keys_pb';
import * as ethereum from 'bitbadgesjs-proto/dist/proto/ethereum/ethsecp256k1/keys_pb';
import { convertToCosmosAddress, getChainForAddress, SupportedChain } from "bitbadgesjs-utils";
import { BadgeCollection } from "bitbadgesjs-proto/dist/proto/badges/collections_pb";
import { ApprovalTracker, UserBalanceStore } from "bitbadgesjs-proto/dist/proto/badges/transfers_pb";
import { AddressList } from "bitbadgesjs-proto/dist/proto/badges/address_lists_pb";
import { Protocol } from "bitbadgesjs-proto/dist/proto-types/protocols/types"

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
  btcAddress: string
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
  } else if (accountObj.pubKey?.value) { /// && chain == SupportedChain.COSMOS
    const pub_key = secp256k1.PubKey.fromBinary(accountObj.pubKey.value).key;
    pubKeyStr = Buffer.from(pub_key).toString('base64');
  }

  return {
    publicKey: pubKeyStr,
    sequence: accountObj.sequence ? accountObj.sequence.toString() : "0",
    accountNumber: accountObj.accountNumber !== undefined && accountObj.accountNumber >= 0 ? accountObj.accountNumber.toString() : "0",
    chain,
    ethAddress: accountObj.address ? cosmosToEth(accountObj.address) : '',
    btcAddress: accountObj.address ? cosmosToBtc(accountObj.address) : '',
    // solAddress: '',
    cosmosAddress: accountObj.address ? convertToCosmosAddress(accountObj.address) : '',
  }
}

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>
    readonly getCollection: (collectionId: string) => Promise<BadgeCollection | undefined>
    readonly getBalance: (collectionId: string, address: string) => Promise<UserBalanceStore | undefined>
    readonly getAddressList: (listId: string) => Promise<AddressList | undefined>
    readonly getApprovalTracker: (collectionId: string, approvalLevel: string, approverAddress: string, amountTrackerId: string, trackerType: string, approvedAddress: string) => Promise<ApprovalTracker | undefined>
    readonly getChallengeTracker: (collectionId: string, approvalLevel: string, approverAddress: string, challengeTrackerId: string, leafIndex: string) => Promise<string | undefined>


  }

  readonly protocols: {
    readonly getProtocol: (name: string) => Promise<Protocol>
    readonly getCollectionIdForProtocol: (name: string, address: string) => Promise<bigint | undefined>
  }
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
  const rpc = createProtobufRpcClient(base)

  return {
    protocols: {
      getProtocol: async (name: string): Promise<Protocol> => {
        const protocolData = new protocolsQuery.QueryGetProtocolRequest({ name: name }).toBinary();
        const protocolPromise = await rpc.request(
          'protocols.Query',
          'GetProtocol',
          protocolData
        )

        const protocol = protocolsQuery.QueryGetProtocolResponse.fromBinary(protocolPromise).protocol;
        if (!protocol) throw new Error("Protocol not found");

        return {
          name: protocol.name,
          createdBy: protocol.createdBy,
          uri: protocol.uri,
          customData: protocol.customData,
          isFrozen: protocol.isFrozen
        }
      },

      getCollectionIdForProtocol: async (name: string, address: string): Promise<bigint | undefined> => {
        const collectionForProtocolData = new protocolsQuery.QueryGetCollectionIdForProtocolRequest({ name: name, address: address }).toBinary();
        const collectionForProtocolPromise = await rpc.request(
          'protocols.Query',
          'GetCollectionIdForProtocol',
          collectionForProtocolData
        )

        const id = protocolsQuery.QueryGetCollectionIdForProtocolResponse.fromBinary(collectionForProtocolPromise).collectionId;
        return id ? BigInt(id) : undefined;
      }
    },

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
            btcAddress: cosmosToBtc(convertToCosmosAddress(address)),
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

      getAddressList: async (listId: string) => {
        const addressListData = new bitbadgesQuery.QueryGetAddressListRequest({ listId: listId }).toBinary();
        const addressListPromise = await rpc.request(
          'badges.Query',
          'GetAddressList',
          addressListData
        )

        return bitbadgesQuery.QueryGetAddressListResponse.fromBinary(addressListPromise).list;
      },

      getApprovalTracker: async (collectionId: string, approvalLevel: string, approverAddress: string, amountTrackerId: string, trackerType: string, approvedAddress: string) => {
        const approvalTrackerData = new bitbadgesQuery.QueryGetApprovalTrackerRequest({
          collectionId: collectionId ?? "",
          approvalLevel: approvalLevel ?? "",
          approverAddress: approverAddress ?? "",
          amountTrackerId: amountTrackerId ?? "",
          trackerType: trackerType ?? "",
          approvedAddress: approvedAddress ?? ""
        }).toBinary();
        const approvalTrackerPromise = await rpc.request(
          'badges.Query',
          'GetApprovalTracker',
          approvalTrackerData
        )

        return bitbadgesQuery.QueryGetApprovalTrackerResponse.fromBinary(approvalTrackerPromise).tracker;
      },

      getChallengeTracker: async (collectionId: string, approvalLevel: string, approverAddress: string, challengeTrackerId: string, leafIndex: string) => {
        const challengeTrackerData = new bitbadgesQuery.QueryGetChallengeTrackerRequest({
          collectionId: collectionId,
          approvalLevel: approvalLevel,
          approverAddress: approverAddress,
          challengeTrackerId: challengeTrackerId,
          leafIndex: leafIndex
        }).toBinary();

        const challengeTrackerPromise = await rpc.request(
          'badges.Query',
          'GetChallengeTracker',
          challengeTrackerData
        )

        return bitbadgesQuery.QueryGetChallengeTrackerResponse.fromBinary(challengeTrackerPromise).numUsed;
      }
    },
  }
}