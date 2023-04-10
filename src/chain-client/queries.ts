import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { AccountDocument, convertToCosmosAddress } from "bitbadges-sdk";
import { cosmosToEth } from "bitbadgesjs-address-converter";
import * as query from "bitbadgesjs-proto/dist/proto/badges/query";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query";
import * as ethermint from 'bitbadgesjs-proto/dist/proto/ethermint/crypto/v1/ethsecp256k1/keys';
export interface BadgesExtension {
    readonly badges: {
        readonly getAccountInfo: (address: string) => Promise<AccountDocument>
        readonly getAccountInfoByNumber: (accountNum: number) => Promise<AccountDocument>
    }
}

const getAccountInfoToReturn = (accountPromise: Uint8Array) => {
    const accountInfo = accountQuery.cosmos.auth.v1beta1.QueryAccountResponse.deserialize(accountPromise).account
    const accountInfoValue = accountInfo.toObject().value;
    if (!accountInfoValue) throw new Error("Account not found");

    const accountObj = account.cosmos.auth.v1beta1.BaseAccount.deserialize(accountInfoValue).toObject();
    let pubKeyStr = '';
    let chain = 'Unknown'
    if (accountObj.pub_key?.type_url) {
        if (accountObj.pub_key.type_url === '/ethermint.crypto.v1.ethsecp256k1.PubKey') {
            chain = 'Ethereum'
        } else if (accountObj.pub_key.type_url === '/cosmos.crypto.secp256k1.PubKey') {
            chain = 'Cosmos'
        }
    }


    if (accountObj.pub_key?.value) {
        const pub_key = ethermint.ethermint.crypto.v1.ethsecp256k1.PubKey.deserialize(accountObj.pub_key.value).key;
        pubKeyStr = Buffer.from(pub_key).toString('base64');
    }

    return {
        ...accountObj,
        pub_key: pubKeyStr,
        sequence: accountObj.sequence ? accountObj.sequence : 0,
        account_number: accountObj.account_number ? accountObj.account_number : -1,
        chain,
        cosmosAddress: accountObj.address ? convertToCosmosAddress(accountObj.address) : '',
        address: chain === 'Cosmos' && accountObj.address ? accountObj.address : cosmosToEth(accountObj.address ? accountObj.address : ''),
    }
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
    const rpc = createProtobufRpcClient(base)

    return {
        badges: {
            getAccountInfo: async (address: string): Promise<AccountDocument> => {
                try {
                    const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address }).serialize();

                    const accountPromise = await rpc.request(
                        'cosmos.auth.v1beta1.Query',
                        'Account',
                        accountData
                    )

                    return getAccountInfoToReturn(accountPromise);
                } catch (error) {
                    console.log(error);
                    // await ERRORS_DB.bulk({ docs: [{ error: error, date: new Date().toISOString(), message: 'Fetching ' + address }] })
                    return {
                        address: address,
                        account_number: -1,
                        sequence: 0,
                        cosmosAddress: convertToCosmosAddress(address),
                        chain: 'Unknown',
                        pub_key: '',
                    }
                }
            },
            getAccountInfoByNumber: async (accountNum: number): Promise<AccountDocument> => {
                try {
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

                    const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address: returnedAddress }).serialize();

                    const accountPromise = await rpc.request(
                        'cosmos.auth.v1beta1.Query',
                        'Account',
                        accountData
                    )

                    return getAccountInfoToReturn(accountPromise);
                } catch (error) {
                    console.log(error);
                    // await ERRORS_DB.bulk({ docs: [{ error: error, date: new Date().toISOString(), message: 'Fetching ' + accountNum }] })
                    return {
                        address: '',
                        account_number: -1,
                        sequence: 0,
                        cosmosAddress: '',
                        chain: 'Unknown',
                        pub_key: '',
                    }
                }
            },
        },
    }
}