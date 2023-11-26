import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth } from "bitbadgesjs-utils";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth_pb";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query_pb";
import * as crypto from 'bitbadgesjs-proto/dist/proto/cosmos/crypto/ed25519/keys_pb';
import * as ethereum from 'bitbadgesjs-proto/dist/proto/ethereum/keys_pb';
import { convertToCosmosAddress, getChainForAddress, SupportedChain } from "bitbadgesjs-utils";

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
  // solAddress: string -  can't do it directly here because we don't have the solana address yet (can't revert a hash)
  accountNumber: string
}

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>
  }
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
    },
  }
}