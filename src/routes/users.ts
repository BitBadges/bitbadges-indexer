import { Request, Response } from "express";
import { ACCOUNTS_DB, COLLECTIONS_DB } from "../db/db";
import { ethers } from "ethers";
import { convertToCosmosAddress, getChainForAddress, isAddressValid } from "../bitbadges-api/chains";

export async function appendNameForAccount(account: any) {
    const newAccount = {
        ...account
    };
    const provider = new ethers.InfuraProvider(
        'homestead',
        process.env.INFURA_API_KEY
    );

    if (ethers.isAddress(account.address)) {
        const ensAddress = await provider.lookupAddress(account.address);
        if (ensAddress) newAccount.name = ensAddress;
    }


    return newAccount;
}

export const getBatchUsers = async (req: Request, res: Response) => {
    let accountNumsResponse;
    let addressesResponse;
    req.body.accountNums = req.body.accountNums.filter((num: number) => num >= 0);
    console.log(req.body.accountNums);
    if (req.body.accountNums && req.body.accountNums.length !== 0) {

        const response = await ACCOUNTS_DB.fetch({ keys: req.body.accountNums.map((num: number) => `${num}`) });
        accountNumsResponse = response.rows.map((row: any) => row.doc);
    } else {
        accountNumsResponse = [];
    }

    const nameMap: { [address: string]: string } = {};

    const resolvedAddresses = [];
    for (const address of req.body.addresses) {
        if (isAddressValid(address)) {
            resolvedAddresses.push(address);
        } else if (address.includes('.eth')) {
            try {
                //Attempt to resolve name
                const provider = new ethers.InfuraProvider(
                    'homestead',
                    process.env.INFURA_API_KEY
                );
                const resolvedAddress = await provider.resolveName(address);
                if (resolvedAddress) {
                    resolvedAddresses.push(resolvedAddress);
                    nameMap[resolvedAddress] = address;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }

    if (resolvedAddresses && resolvedAddresses.length !== 0) {
        const response = await ACCOUNTS_DB.find(
            {
                selector: {
                    $or: [
                        {
                            address: {
                                $in: resolvedAddresses
                            }
                        },
                        {
                            cosmosAddress: {
                                $in: resolvedAddresses
                            }
                        }
                    ]
                }
            }
        );
        addressesResponse = response.docs;
        for (const address of resolvedAddresses) {
            if (isAddressValid(address) && !addressesResponse.find((account: any) => account.address === address)) {
                addressesResponse.push({
                    accountNumber: -1,
                    chain: getChainForAddress(address),
                    address: address,
                    cosmosAddress: convertToCosmosAddress(address),
                    name: '',
                });
            }
        }
    } else {
        addressesResponse = [];
    }

    console.log(addressesResponse);


    const returnedAccounts = [];
    for (const account of [...accountNumsResponse, ...addressesResponse]) {
        if (nameMap[account.address]) {
            returnedAccounts.push({
                ...account,
                name: nameMap[account.address]
            });
        }
        else {
            const x = await appendNameForAccount(account);
            returnedAccounts.push(x);
        }
    }

    console.log(returnedAccounts);


    return res.status(200).send({ accounts: returnedAccounts });
}

export const getPortfolioInfo = async (req: Request, res: Response) => {
    // let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));

    const accountNumIdx = `${Number(req.params.accountNum)}`;
    // const balanceField = `balances.${accountNumIdx}`;

    const q: any = {};
    q.selector = {
        balances: {}
    }
    q.selector.balances[accountNumIdx] = {
        "balances": {
            "$gt": null
        }
    }

    const response = await COLLECTIONS_DB.find(q);

    const managingQuery: any = {};
    managingQuery.selector = {
        manager: {
            "$eq": Number(req.params.accountNum)
        }
    }

    const managingResponse = await COLLECTIONS_DB.find(q);


    return res.status(200).send({
        collected: response.docs,
        managing: managingResponse.docs,
    });
}