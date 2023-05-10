import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth } from "bitbadgesjs-address-converter";
import * as query from "bitbadgesjs-proto/dist/proto/badges/query";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query";
import * as ethermint from 'bitbadgesjs-proto/dist/proto/ethermint/crypto/v1/ethsecp256k1/keys';
import { convertToCosmosAddress, isAddressValid, SupportedChain } from "bitbadgesjs-utils";

/**
 * The chain will return a similar structure but with a pub_key object and account_number field (see CosmosAccountResponse from bitbadgesjs-utils)
 * 
 * Here, we clean up the response to return a more conventional object for our purposes.
 */
export interface CleanedCosmosAccountInformation {
  publicKey: string
  sequence: number
  accountNumber: number
  chain: SupportedChain
  cosmosAddress: string
  address: string
}

export interface BadgesExtension {
  readonly badges: {
    readonly getAccountInfo: (address: string) => Promise<CleanedCosmosAccountInformation>
    readonly getAccountInfoByNumber: (accountNum: number) => Promise<CleanedCosmosAccountInformation>
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
    sequence: accountObj.sequence ? accountObj.sequence : 0,
    accountNumber: accountObj.account_number !== undefined && accountObj.account_number >= 0 ? accountObj.account_number : 0,
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
        try {
          //Native Cosmos SDK x/auth query for account information
          const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address }).serialize();
          const accountPromise = await rpc.request(
            'cosmos.auth.v1beta1.Query',
            'Account',
            accountData
          )

          return getAccountInfoToReturn(accountPromise);
        } catch (error) {
          console.log(error);
          if (isAddressValid(address)) {
            console.log("Error fetching account: invalid address");
          }


          return {
            address: address,
            accountNumber: -1,
            sequence: 0,
            cosmosAddress: convertToCosmosAddress(address),
            chain: SupportedChain.UNKNOWN,
            publicKey: '',
          }
        }
      },
      getAccountInfoByNumber: async (accountNum: number): Promise<CleanedCosmosAccountInformation> => {
        try {
          //BitBadges x/badges GetAddressById helper query for account information
          const data = query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdRequest.fromObject({ id: accountNum }).serialize();
          const promise = await rpc.request(
            'bitbadges.bitbadgeschain.badges.Query',
            'GetAddressById',
            data
          )

          const returnedAddress = query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdResponse.deserialize(promise).address
          if (returnedAddress === '') {
            throw 'Account not found'
          }

          //Native Cosmos SDK x/auth query for account information
          const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address: returnedAddress }).serialize();
          const accountPromise = await rpc.request(
            'cosmos.auth.v1beta1.Query',
            'Account',
            accountData
          )

          return getAccountInfoToReturn(accountPromise);
        } catch (error) {
          console.log(error);
          return {
            address: '',
            accountNumber: -1,
            sequence: 0,
            cosmosAddress: '',
            chain: SupportedChain.UNKNOWN,
            publicKey: '',
          }
        }
      },
    },
  }
}