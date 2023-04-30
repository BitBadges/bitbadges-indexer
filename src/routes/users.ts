import { AccountResponse, ActivityItem, ReviewActivityItem, StoredBadgeCollection, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, ACTIVITY_DB, AIRDROP_DB, COLLECTIONS_DB } from "../db/db";
import { client } from "../indexer";
import { getAddressesForNames, getEnsDetails, getEnsResolver, getEnsResolversForNames, getNameForAddress, getNamesForAddresses } from "../util/ensResolvers";
import { Coin } from "@cosmjs/stargate";
import { getStatus } from "../db/status";


export const getAccountByAddress = async (req: Request, res: Response) => {
    try {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(req.params.address);
        let balanceInfo: Coin = {
            denom: 'badge',
            amount: '0'
        };

        let alreadyAirdropped = true;

        if (accountInfo?.cosmosAddress) {
            balanceInfo = await client.getBalance(accountInfo.cosmosAddress, 'badge');


            //if no error, already has doc which means we have airdropped
            alreadyAirdropped = await AIRDROP_DB.head(accountInfo.cosmosAddress).then(() => true).catch((e) => {
                //Only if missing error
                if (e.statusCode === 404) {
                    return false;
                }
                return true;
            });
        }

        accountInfo = await appendNameForAccount(accountInfo);
        if (accountInfo && accountInfo.account_number >= 0) {
            try {
                const accountDoc = await ACCOUNTS_DB.get(`${accountInfo.account_number}`);
                if (accountDoc) {
                    return res.status(200).send({ ...accountDoc, ...accountInfo, balance: balanceInfo, airdropped: alreadyAirdropped });
                }
            } catch (e) { }
        }
        return res.status(200).send({ ...accountInfo, balance: balanceInfo, airdropped: alreadyAirdropped });
    } catch (e) {
        return res.status(500).send({
            error: 'Error fetching account. Please try again later.'
        })
    }
};

export const getAccountById = async (req: Request, res: Response) => {
    try {
        let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));
        let balanceInfo: Coin = {
            denom: 'badge',
            amount: '0'
        };

        let alreadyAirdropped = true;


        if (accountInfo?.cosmosAddress) {
            balanceInfo = await client.getBalance(accountInfo.cosmosAddress, 'badge');

            //if no error, already has doc which means we have airdropped
            alreadyAirdropped = await AIRDROP_DB.head(accountInfo.cosmosAddress).then(() => true).catch((e) => {
                //Only if missing error
                if (e.statusCode === 404) {
                    return false;
                }
                return true;
            });
        }



        accountInfo = await appendNameForAccount(accountInfo);
        if (accountInfo && accountInfo.account_number >= 0) {
            try {
                const accountDoc = await ACCOUNTS_DB.get(`${accountInfo.account_number}`);
                if (accountDoc) {
                    return res.status(200).send({ ...accountDoc, ...accountInfo, balance: balanceInfo, airdropped: alreadyAirdropped });
                }
            } catch (e) { }
        }

        return res.status(200).send({ ...accountInfo, balance: balanceInfo, airdropped: alreadyAirdropped });
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
        return { name: ensName, resolvedName: ensName, ...account,  ...details };
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
                account.name = account.name ? account.name : names[i];
                account.resolvedName = names[i];
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
                        resolvedName: '',
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
            account.name = account.name ? account.name : names[i];
            account.resolvedName = names[i]
            account.chain = getChainForAddress(account.address);
            if (handledAvatarsMap[account.address]) {
                resolverPromises.push(Promise.resolve(null));
            } else {
                resolverPromises.push(getEnsResolver(account.resolvedName));
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

async function executeReviewsQuery(cosmosAddress: string, bookmark?: string) {
  const reviewsRes = await ACTIVITY_DB.partitionedFind(`user-${cosmosAddress}` ,{
      selector: {
          "method": {
              "$eq": "Review"
          },
          timestamp: {
              "$gt": null,
          }
      },
      sort: ["timestamp"],
      bookmark: bookmark ? bookmark : undefined,
  });

  return reviewsRes;
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

export const addReviewForUser = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    if (!req.body.review || req.body.review.length > 2048) {
        return res.status(400).send({ error: 'Review must be 1 to 2048 characters long.' });
    }

    const stars = Number(req.body.stars);
    if (isNaN(stars) || stars < 0 || stars > 5) {
        return res.status(400).send({ error: 'Stars must be a number between 0 and 5.' });
    }

    const cosmosAddress = convertToCosmosAddress(req.params.cosmosAddress);

    const userAccountInfo = await ACCOUNTS_DB.find({
        selector: {
            cosmosAddress: {
                $eq: req.session.cosmosAddress
            }
        }
    });

    if (userAccountInfo.docs.length === 0) {
        return res.status(400).send({ error: 'User does not exist.' });
    }

    const status = await getStatus();

    const { review } = req.body;

    const activityDoc: ReviewActivityItem & {
        _id: string
    } = {
        _id: `user-${cosmosAddress}:${Date.now()}`,
        method: 'Review',
        cosmosAddress: cosmosAddress,
        stars: stars,
        review: review,
        from: userAccountInfo.docs[0].account_number,
        timestamp: Date.now(),
        block: status.block.height,
        users: [],
    }

    await ACTIVITY_DB.insert(activityDoc);

    return res.status(200).send({ success: true });
} catch (e) {
    console.error(e);
    return res.status(500).send({
        error: 'Error adding announcement. Please try again later.'
    })
}

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
        const reviewsBookmark = req.body.reviewsBookmark;
        const accountDoc = await ACCOUNTS_DB.find({
            selector: {
                cosmosAddress: {
                    $eq: req.params.cosmosAddress
                }
            }
        });

        let accountNumIdx = -1;
        if (accountDoc.docs[0]) {
            accountNumIdx = Number(accountDoc.docs[0].account_number);
        }



        let response: nano.MangoResponse<StoredBadgeCollection>;
        let activityRes: nano.MangoResponse<ActivityItem>;
        let announcementsRes: nano.MangoResponse<ActivityItem>;
        let reviewsRes: nano.MangoResponse<ActivityItem>;
        
        if (accountNumIdx === -1) {
            response = {
                docs: [],
            }
            activityRes = {
                docs: [],
            }
            announcementsRes = {
                docs: [],
            }
          } else {

        // Do not fetch if we have a user activity bookmark but no collected bookmark
        if ((userActivityBookmark || announcementsBookmark || reviewsBookmark) && !collectedBookmark) {
            response = {
                docs: [],
            }
        } else {
            response = await executeCollectedQuery(accountNumIdx, collectedBookmark);
        }

        // Do not fetch if we have a collected bookmark but no user activity bookmark
        if ((collectedBookmark || announcementsBookmark || reviewsBookmark) && !userActivityBookmark) {
            activityRes = {
                docs: [],
            }
        } else {
            activityRes = await executeActivityQuery(accountNumIdx, userActivityBookmark);
        }

        // Do not fetch if we have a collected bookmark but no user activity bookmark
        if ((collectedBookmark || userActivityBookmark || reviewsBookmark ) && !announcementsBookmark) {
            announcementsRes = {
                docs: [],
            }
        } else {
            announcementsRes = await executeAnnouncementsQuery(accountNumIdx, announcementsBookmark);
        }
      }

        
        if ((collectedBookmark || userActivityBookmark || announcementsBookmark ) && !reviewsBookmark) {
          reviewsRes = {
              docs: [],
          }
      } else {
          reviewsRes = await executeReviewsQuery(req.params.cosmosAddress, reviewsBookmark);
      }

        return res.status(200).send({
            collected: response.docs.filter((x) => !!x.balances[accountNumIdx] && x.balances[accountNumIdx].balances.length > 0),
            activity: activityRes.docs.filter((x) => x.method === 'Transfer' || x.method === 'Mint'),
            announcements: announcementsRes.docs.filter((x) => x.method === 'Announcement'),
            reviews: reviewsRes.docs.filter((x) => x.method === 'Review'),
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
                reviews: {
                    bookmark: reviewsRes.bookmark,
                    hasMore: reviewsRes.docs.length === 25
                }
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
            name: req.body.name ? req.body.name : response.docs[0].name,
        };
        const regex = /^[a-zA-Z0-9_\-]+$/; 
        if (newAccountInfo.name && !regex.test(newAccountInfo.name) && newAccountInfo.name.length > 0) {
            return res.status(500).send({
                error: 'Error updating portfolio. Name must be alphanumeric and can only contain underscores and dashes.'
            })
        }

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