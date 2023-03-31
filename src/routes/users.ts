import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, COLLECTIONS_DB } from "../db/db";
import { client } from "../indexer";
import { getAddressesForNames, getNameForAddress, getNamesForAddresses } from "../util/ensResolvers";
import { AccountResponse, isAddressValid, getChainForAddress, convertToCosmosAddress, ActivityItem } from "bitbadges-sdk";


export const getAccountByAddress = async (req: Request, res: Response) => {
    try {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(req.params.address);
        accountInfo = await appendNameForAccount(accountInfo);
        return res.status(200).send({ ...accountInfo });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching account. Please try again later.'
        })
    }
};

export const getAccountById = async (req: Request, res: Response) => {
    try {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));
        accountInfo = await appendNameForAccount(accountInfo);

        return res.status(200).send({ ...accountInfo });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching account. Please try again later.'
        })
    }
}

export async function appendNameForAccount(account: any) {
    try {
        const ensAddress = await getNameForAddress(account.address);
        return { ...account, name: ensAddress };
    } catch (e) {
        return account;
    }
}

export const getBatchUsers = async (req: Request, res: Response) => {
    try {
        let accountsResponse: (AccountResponse & nano.DocumentGetResponse)[] = [];
        req.body.accountNums = req.body.accountNums.filter((num: number) => num >= 0);

        if (req.body.accountNums && req.body.accountNums.length !== 0) {
            const response = await ACCOUNTS_DB.fetch({ keys: req.body.accountNums.map((num: number) => `${num}`) });
            accountsResponse = response.rows.map((row: any) => row.doc);

            const names = await getNamesForAddresses(accountsResponse.map((account) => account.address));
            for (let i = 0; i < accountsResponse.length; i++) {
                const account = accountsResponse[i];
                account.name = names[account.address];
            }

            if (response.rows.find(row => row.error)) {
                return res.status(500).send({
                    error: 'Error fetching account. Please try again later.'
                })
            }
        }


        const nameMap: { [address: string]: string } = {};
        const nonDuplicates = req.body.addresses.filter((address: string) => !accountsResponse.find((account) => account.address === address || account.cosmosAddress === address));
        const resolvedAddresses = [];
        const nonValidAddresses = nonDuplicates.filter((address: string) => !isAddressValid(address));
        const validAddresses = nonDuplicates.filter((address: string) => isAddressValid(address));
        const resolvedAddressesForENSNames = (await getAddressesForNames(nonValidAddresses)).filter((address: string) => isAddressValid(address));
        resolvedAddresses.push(...resolvedAddressesForENSNames, ...validAddresses);
        for (const address of resolvedAddressesForENSNames) {
            nameMap[address] = nonValidAddresses[resolvedAddressesForENSNames.indexOf(address)];
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
            accountsResponse = [...accountsResponse, ...response.docs];

            //If a valid address but not in the db, add it to the response
            for (const address of resolvedAddresses) {
                if (isAddressValid(address) && !accountsResponse.find((account) => account.address === address || account.cosmosAddress === address)) {
                    accountsResponse.push({
                        _id: '-1',
                        _rev: '',
                        account_number: -1,
                        chain: getChainForAddress(address),
                        address: address,
                        cosmosAddress: convertToCosmosAddress(address),
                        name: '',
                        sequence: -1,
                        pub_key: ''
                    });
                }
            }
        }

        for (const account of accountsResponse) {
            if (nameMap[account.address]) {
                account.name = nameMap[account.address];
            }
        }

        return res.status(200).send({ accounts: accountsResponse });
    } catch (e) {
        console.log(e);
        return res.status(500).send({
            error: 'Error fetching accounts. Please try again later.'
        })
    }
}

export const getPortfolioInfo = async (req: Request, res: Response) => {
    try {
        const accountNumIdx = `${Number(req.params.accountNum)}`;
        const q: nano.MangoQuery = {
            selector: {
                "$or": [
                    {
                        "balances": {
                            [accountNumIdx]: {
                                "$gt": null
                            }
                        }
                    },
                    {
                        "manager": {
                            "$eq": Number(req.params.accountNum)
                        }
                    },
                    {
                        "activity": {
                            "$elemMatch": {
                                "$or": [
                                    {
                                        "to": {
                                            "$elemMatch": {
                                                "$eq": Number(req.params.accountNum)
                                            }
                                        }
                                    },
                                    {
                                        "from": {
                                            "$elemMatch": {
                                                "$eq": Number(req.params.accountNum)
                                            }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        };

        const response = await COLLECTIONS_DB.find(q);

        const activity: (ActivityItem & { collectionId: number })[] = [];
        for (const doc of response.docs) {
            for (const activityItem of doc.activity) {
                if (activityItem.to.includes(Number(req.params.accountNum)) || activityItem.from.includes(Number(req.params.accountNum))) {
                    activity.push({
                        ...activityItem,
                        collectionId: Number(doc._id),
                    });
                }
            }
        }

        return res.status(200).send({
            collected: response.docs.filter((x) => !!x.balances[accountNumIdx]),
            activity: activity,
            managing: response.docs.filter((x) => x.manager === Number(req.params.accountNum)),
        });
    } catch (e) {
        console.log(e);
        return res.status(500).send({
            error: 'Error fetching portfolio. Please try again later.'
        })
    }
}