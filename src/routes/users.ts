import { AccountResponse, ActivityItem, StoredBadgeCollection, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadges-sdk";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { ACCOUNTS_DB, ACTIVITY_DB, COLLECTIONS_DB } from "../db/db";
import { client } from "../indexer";
import { getAddressesForNames, getEnsDetails, getEnsResolver, getEnsResolversForNames, getNameForAddress, getNamesForAddresses } from "../util/ensResolvers";


export const getAccountByAddress = async (req: Request, res: Response) => {
    try {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(req.params.address);
        accountInfo = await appendNameForAccount(accountInfo);
        if (accountInfo && accountInfo.account_number >= 0) {
            const accountDoc = await ACCOUNTS_DB.get(`${accountInfo.account_number}`);
            if (accountDoc) {
                return res.status(200).send({ ...accountDoc, ...accountInfo, });
            }
        }
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
        if (accountInfo && accountInfo.account_number >= 0) {
            const accountDoc = await ACCOUNTS_DB.get(`${accountInfo.account_number}`);
            if (accountDoc) {
                return res.status(200).send({ ...accountDoc, ...accountInfo, });
            }
        }

        return res.status(200).send({ ...accountInfo });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching account. Please try again later.'
        })
    }
}

export async function appendNameForAccount(account: any) {
    try {
        const ensName = await getNameForAddress(account.address);
        let details = {};
        if (ensName) {
            const resolver = await getEnsResolver(ensName);
            if (resolver) {
                details = await getEnsDetails(resolver);
            }
        }
        return { ...account, name: ensName, ...details };
    } catch (e) {
        return account;
    }
}

export const getBatchUsers = async (req: Request, res: Response) => {
    try {
        const handledNamesMap: { [address: string]: boolean } = {};
        const handledAvatarsMap: { [address: string]: boolean } = {};
        let accountsResponse: (AccountResponse & nano.DocumentGetResponse)[] = [];
        req.body.accountNums = req.body.accountNums.filter((num: number) => num >= 0);

        if (req.body.accountNums && req.body.accountNums.length !== 0) {
            const response = await ACCOUNTS_DB.fetch({ keys: req.body.accountNums.map((num: number) => `${num}`) });
            accountsResponse = response.rows.map((row: any) => row.doc);

            const names = await getNamesForAddresses(accountsResponse.map((account) => account.address));
            for (let i = 0; i < accountsResponse.length; i++) {
                const account = accountsResponse[i];
                account.name = names[i];
                account.chain = getChainForAddress(account.address);
                handledNamesMap[account.address] = true;
            }

            const resolvers = await getEnsResolversForNames(names);


            const detailsPromises = [];
            for (let i = 0; i < accountsResponse.length; i++) {
                const resolver = resolvers[i];
                if (resolver) {
                    detailsPromises.push(getEnsDetails(resolver));
                } else {
                    detailsPromises.push({});
                }
            }

            const detailsResults = await Promise.all(detailsPromises);

            for (let i = 0; i < accountsResponse.length; i++) {
                let account = accountsResponse[i];
                account = { ...account, ...detailsResults[i] };
                handledAvatarsMap[account.address] = true;
            }

            if (response.rows.find(row => row.error)) {
                return res.status(500).send({
                    error: 'Error fetching account. Please try again later.'
                })
            }
        }

        const nonDuplicates = req.body.addresses.filter((address: string) => !accountsResponse.find((account) => account.address === address || account.cosmosAddress === address));
        const resolvedAddresses = [];
        const nonValidAddresses = nonDuplicates.filter((address: string) => !isAddressValid(address));
        const validAddresses = nonDuplicates.filter((address: string) => isAddressValid(address));
        const resolvedAddressesForENSNames = (await getAddressesForNames(nonValidAddresses)).filter((address: string) => isAddressValid(address));
        for (const address of resolvedAddressesForENSNames) {
            handledNamesMap[address] = true;
        }
        resolvedAddresses.push(...resolvedAddressesForENSNames, ...validAddresses);

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
                    },
                    limit: resolvedAddresses.length
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
                        avatar: '',
                        github: '',
                        twitter: '',
                        telegram: '',
                        discord: '',
                        sequence: -1,
                        pub_key: ''
                    });
                }
            }
        }

        const namePromises = [];
        for (const account of accountsResponse) {
            if (handledNamesMap[account.address]) {
                namePromises.push(Promise.resolve(account.name ? account.name : ''));
            } else {
                namePromises.push(getNameForAddress(account.address));
                handledNamesMap[account.address] = true;
            }
        }


        const names = await Promise.all(namePromises);
        const resolverPromises = [];
        for (let i = 0; i < accountsResponse.length; i++) {
            const account = accountsResponse[i];
            account.name = names[i];
            account.chain = getChainForAddress(account.address);
            if (handledAvatarsMap[account.address]) {
                resolverPromises.push(Promise.resolve(null));
            } else {
                resolverPromises.push(getEnsResolver(account.name));
                handledAvatarsMap[account.address] = true;
            }
        }

        const resolvers = await Promise.all(resolverPromises);

        const detailsPromises = [];
        for (let i = 0; i < accountsResponse.length; i++) {
            const resolver = resolvers[i];
            if (resolver) {
                detailsPromises.push(getEnsDetails(resolver));
            } else {
                detailsPromises.push(Promise.resolve({}));
            }
        }


        const detailsResults = await Promise.all(detailsPromises);

        for (let i = 0; i < accountsResponse.length; i++) {
            accountsResponse[i] = { ...accountsResponse[i], ...detailsResults[i] };
        }

        return res.status(200).send({ accounts: accountsResponse });
    } catch (e) {
        console.log(e);
        return res.status(500).send({
            error: 'Error fetching accounts. Please try again later.'
        })
    }
}

async function executeActivityQuery(accountNum: number, bookmark?: string) {
    const activityRes = await ACTIVITY_DB.find({
        selector: {
            "users": {
                "$elemMatch": {
                    "$and": [
                        {
                            "start": {
                                "$lte": Number(accountNum),
                            },
                            "end": {
                                "$gte": Number(accountNum),
                            }
                        },
                    ]
                }
            },
            "method": {
                "$or": [
                    {
                        "$eq": "Transfer"
                    },
                    {
                        "$eq": "Mint"
                    }
                ]
            },
            timestamp: {
                "$gt": null,
            }
        },
        sort: ["timestamp"],
        bookmark: bookmark ? bookmark : undefined,
    });

    return activityRes;
}

async function executeAnnouncementsQuery(accountNum: number, bookmark?: string) {
    const announcementsRes = await ACTIVITY_DB.find({
        selector: {
            "users": {
                "$elemMatch": {
                    "$and": [
                        {
                            "start": {
                                "$lte": Number(accountNum),
                            },
                            "end": {
                                "$gte": Number(accountNum),
                            }
                        },
                    ]
                }
            },
            "method": {
                "$eq": "Announcement"
            },
            timestamp: {
                "$gt": null,
            }
        },
        sort: ["timestamp"],
        bookmark: bookmark ? bookmark : undefined,
    });

    return announcementsRes;
}

async function executeCollectedQuery(accountNum: number, bookmark?: string) {
    const collectedRes = await COLLECTIONS_DB.find({
        selector: {
            "$or": [
                {
                    "balances": {
                        [`${Number(accountNum)}`]: {
                            "$gt": null
                        }
                    }
                },
                // {
                //     "manager": {
                //         "$eq": Number(req.params.accountNum)
                //     }
                // },
            ]
        },
        bookmark: bookmark ? bookmark : undefined
    });

    return collectedRes;
}

export const getActivity = async (req: Request, res: Response) => {
    try {
        const activityRes = await executeActivityQuery(Number(req.params.accountNum));
        const announcementsRes = await executeAnnouncementsQuery(Number(req.params.accountNum));

        return res.status(200).send({
            activity: activityRes.docs,
            announcements: announcementsRes.docs,
            pagination: {
                activity: {
                    bookmark: activityRes.bookmark,
                    hasMore: activityRes.docs.length === 25
                },
                announcements: {
                    bookmark: announcementsRes.bookmark,
                    hasMore: announcementsRes.docs.length === 25
                }
            }
        });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching activity. Please try again later.'
        })
    }
}

export const getPortfolioInfo = async (req: Request, res: Response) => {
    try {
        const userActivityBookmark = req.body.userActivityBookmark;
        const collectedBookmark = req.body.collectedBookmark;
        const announcementsBookmark = req.body.announcementsBookmark;
        const accountNumIdx = `${Number(req.params.accountNum)}`;

        let response: nano.MangoResponse<StoredBadgeCollection>;
        let activityRes: nano.MangoResponse<ActivityItem>;
        let announcementsRes: nano.MangoResponse<ActivityItem>;
        // Do not fetch if we have a user activity bookmark but no collected bookmark
        if ((userActivityBookmark || announcementsBookmark) && !collectedBookmark) {
            response = {
                docs: [],
            }
        } else {
            response = await executeCollectedQuery(Number(req.params.accountNum), collectedBookmark);
        }

        // Do not fetch if we have a collected bookmark but no user activity bookmark
        if ((collectedBookmark || announcementsBookmark) && !userActivityBookmark) {
            activityRes = {
                docs: [],
            }
        } else {
            activityRes = await executeActivityQuery(Number(req.params.accountNum), userActivityBookmark);
        }

        // Do not fetch if we have a collected bookmark but no user activity bookmark
        if ((collectedBookmark || userActivityBookmark) && !announcementsBookmark) {
            announcementsRes = {
                docs: [],
            }
        } else {
            announcementsRes = await executeAnnouncementsQuery(Number(req.params.accountNum), announcementsBookmark);
        }

        return res.status(200).send({
            collected: response.docs.filter((x) => !!x.balances[accountNumIdx] && x.balances[accountNumIdx].balances.length > 0),
            activity: activityRes.docs.filter((x) => x.method === 'Transfer' || x.method === 'Mint'),
            announcements: announcementsRes.docs.filter((x) => x.method === 'Announcement'),
            managing: response.docs.filter((x) => x.manager === Number(req.params.accountNum)),
            pagination: {
                userActivity: {
                    bookmark: activityRes.bookmark,
                    hasMore: activityRes.docs.length === 25
                },
                announcements: {
                    bookmark: announcementsRes.bookmark,
                    hasMore: announcementsRes.docs.length === 25
                },
                collected: {
                    bookmark: response.bookmark,
                    hasMore: response.docs.length === 25
                },
            }
        });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching portfolio. Please try again later.'
        })
    }
}


export const updateAccountInfo = async (expressReq: Request, res: Response) => {
    try {

        const req = expressReq as AuthenticatedRequest
        const cosmosAddress = req.session.cosmosAddress;

        const response = await ACCOUNTS_DB.find({
            selector: {
                cosmosAddress: {
                    $eq: cosmosAddress
                }
            }
        });

        if (response.docs.length === 0) {
            return res.status(500).send({
                error: 'Error updating portfolio. No docs found. Account must be registered on the BitBadges blockchain first.'
            })
        }

        const newAccountInfo: AccountResponse = {
            ...response.docs[0],
            discord: req.body.discord ? req.body.discord : response.docs[0].discord,
            twitter: req.body.twitter ? req.body.twitter : response.docs[0].twitter,
            github: req.body.github ? req.body.github : response.docs[0].github,
            telegram: req.body.telegram ? req.body.telegram : response.docs[0].telegram,
            seenActivity: req.body.seenActivity ? req.body.seenActivity : response.docs[0].seenActivity,
        };

        await ACCOUNTS_DB.insert(newAccountInfo);

        return res.status(200).send(
            { message: 'Account info updated successfully' }
        );
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching portfolio. Please try again later.'
        })
    }
}