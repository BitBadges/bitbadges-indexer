import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate";
import { cosmosToEth } from "bitbadgesjs-address-converter";
import * as query from "bitbadgesjs-proto/dist/proto/badges/query";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query";
import * as ethermint from 'bitbadgesjs-proto/dist/proto/ethermint/crypto/v1/ethsecp256k1/keys';
import { ERRORS_DB } from "../db/db";

export interface BadgesExtension {
    readonly badges: {
        readonly getAccountInfo: (address: string) => Promise<any>
        readonly getAccountInfoByNumber: (accountNum: number) => Promise<any>
    }
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
    const rpc = createProtobufRpcClient(base)

    return {
        badges: {
            getAccountInfo: async (address: string): Promise<any> => {
                try {
                    //TODO: handle errors
                    if (address === '') return {
                        address: '',
                        account_number: -1,
                    }

                    const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address }).serialize();

                    const accountPromise = await rpc.request(
                        'cosmos.auth.v1beta1.Query',
                        'Account',
                        accountData
                    )

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
                        chain,
                        cosmosAddress: accountObj.address,
                        address: chain === 'Cosmos' ? accountObj.address : cosmosToEth(accountObj.address ? accountObj.address : ''),
                    }
                } catch (error) {
                    console.log(error);
                    await ERRORS_DB.bulk({ docs: [{ error: error, date: new Date().toISOString(), message: 'Fetching ' + address }] })
                    return {
                        address: address,
                        account_number: -1,
                        sequence: 0,
                        cosmosAddress: address,
                        chain: 'Unknown',
                    }
                }
            },
            getAccountInfoByNumber: async (accountNum: number): Promise<any> => {
                try {
                    const data = query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdRequest.fromObject({ id: accountNum }).serialize();

                    const promise = await rpc.request(
                        'bitbadges.bitbadgeschain.badges.Query',
                        'GetAddressById',
                        data
                    )

                    const returnedAddress = query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdResponse.deserialize(promise).address
                    if (returnedAddress === '') return {
                        address: '',
                        account_number: -1,
                        sequence: 0,
                    }

                    const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address: returnedAddress }).serialize();


                    const accountPromise = await rpc.request(
                        'cosmos.auth.v1beta1.Query',
                        'Account',
                        accountData
                    )

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
                        chain,
                        cosmosAddress: accountObj.address,
                        address: chain === 'Cosmos' ? accountObj.address : cosmosToEth(accountObj.address ? accountObj.address : ''),
                    }

                } catch (error) {
                    console.log(error);
                    await ERRORS_DB.bulk({ docs: [{ error: error, date: new Date().toISOString(), message: 'Fetching ' + accountNum }] })
                    return {
                        address: '',
                        account_number: -1,
                        sequence: 0,
                        cosmosAddress: '',
                        chain: 'Unknown',
                    }
                }
            },
        },
    }
}