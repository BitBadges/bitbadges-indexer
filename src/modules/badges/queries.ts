import { createProtobufRpcClient, QueryClient } from "@cosmjs/stargate"
import { BitBadgesUserInfo } from "../../types"
import * as query from "bitbadgesjs-proto/dist/proto/badges/query";
import * as accountQuery from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/query";
import * as account from "bitbadgesjs-proto/dist/proto/cosmos/auth/v1beta1/auth";
import * as ethermint from 'bitbadgesjs-proto/dist/proto/ethermint/crypto/v1/ethsecp256k1/keys';

export interface BadgesExtension {
    readonly badges: {
        readonly getAccountInfo: (accountNum: number) => Promise<BitBadgesUserInfo>
    }
}

export function setupBadgesExtension(base: QueryClient): BadgesExtension {
    const rpc = createProtobufRpcClient(base)

    return {
        badges: {
            getAccountInfo: async (accountNum: number): Promise<any> => {
                const data = query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdRequest.fromObject({ id: accountNum }).serialize();

                const promise = await rpc.request(
                    'bitbadges.bitbadgeschain.badges.Query',
                    'GetAddressById',
                    data
                )

                const accountData = accountQuery.cosmos.auth.v1beta1.QueryAccountRequest.fromObject({ address: query.bitbadges.bitbadgeschain.badges.QueryGetAddressByIdResponse.deserialize(promise).address }).serialize();

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
                if (accountObj.pub_key?.value) {
                    const pub_key = ethermint.ethermint.crypto.v1.ethsecp256k1.PubKey.deserialize(accountObj.pub_key.value).key;
                    pubKeyStr = Buffer.from(pub_key).toString('base64');
                    console.log(pubKeyStr);
                }
                return {
                    ...accountObj,
                    pub_key: pubKeyStr,
                }
            },
        },
    }
}