import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth } from "bitbadgesjs-address-converter";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query";
import * as ethermint from 'bitbadgesjs-proto/dist/proto/ethermint/crypto/v1/ethsecp256k1/keys';
import { convertToCosmosAddress, getChainForAddress, isAddressValid, SupportedChain } from "bitbadgesjs-utils";

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
  address: string
  accountNumber: string
}

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>
  }
}

const getAccountInfoToReturn = (accountPromise: Uint8Array) => {
  //Native Cosmos SDK x/auth query for account information
  const accountInfo = accountQuery.cosmos.auth.v1beta1.QueryAccountResponse.deserialize(accountPromise).account
  const accountInfoValue = accountInfo.toObject().value;
  if (!accountInfoValue) throw new Error("Account not found");

  const accountObj = account.cosmos.auth.v1beta1.BaseAccount.deserialize(accountInfoValue).toObject();

  let pubKeyStr = '';
  let chain = SupportedChain.UNKNOWN
  if (accountObj.pub_key?.type_url) {
    if (accountObj.pub_key.type_url === '/ethermint.crypto.v1.ethsecp256k1.PubKey') {
      chain = SupportedChain.ETH
    } else if (accountObj.pub_key.type_url === '/cosmos.crypto.secp256k1.PubKey') {
      chain = SupportedChain.COSMOS
    }
  }

  if (accountObj.pub_key?.value) {
    const pub_key = ethermint.ethermint.crypto.v1.ethsecp256k1.PubKey.deserialize(accountObj.pub_key.value).key;
    pubKeyStr = Buffer.from(pub_key).toString('base64');
  }

  return {
    publicKey: pubKeyStr,
    sequence: accountObj.sequence ? accountObj.sequence.toString() : "0",
    accountNumber: accountObj.account_number !== undefined && accountObj.account_number >= 0 ? accountObj.account_number.toString() : "0",
    chain,
    cosmosAddress: accountObj.address ? convertToCosmosAddress(accountObj.address) : '',
    address: chain === SupportedChain.COSMOS && accountObj.address ? accountObj.address : cosmosToEth(accountObj.address ? accountObj.address : ''),
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
          const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address: cosmosAddress }).serialize();
          const accountPromise = await rpc.request(
            'cosmos.auth.v1beta1.Query',
            'Account',
            accountData
          )

          return getAccountInfoToReturn(accountPromise);
        } catch (error) {
          if (isAddressValid(address)) {
            console.log("Account not found on chain so returning empty account");
          } else {
            console.log(error);
          }


          return {
            address: address,
            sequence: "0",
            accountNumber: "-1",
            cosmosAddress: convertToCosmosAddress(address),
            chain: getChainForAddress(address),
            publicKey: '',
          }
        }
      },
    },
  }
}