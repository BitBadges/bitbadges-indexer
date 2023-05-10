import { AccountDocument, ActivityItem, BalanceDocument, BitBadgesUserInfo, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB } from "../db/db";
import { client } from "../indexer";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeCollectedQuery, executeReviewsQuery } from "./userHelpers";


export const getAccountByAddress = async (req: Request, res: Response) => {
  try {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(req.params.address);
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen

    // Attempt to fetch the account from the DB
    let accountInfo: AccountDocument = { ...cleanedCosmosAccountInfo };
    if (cleanedCosmosAccountInfo?.cosmosAddress) {
      accountInfo = await ACCOUNTS_DB.get(`${cleanedCosmosAccountInfo.cosmosAddress}`);
    }

    const userInfos = await convertToBitBadgesUserInfo([{ ...accountInfo, ...cleanedCosmosAccountInfo }]); //Newly queried account isw added after bc there may be newer info (sequence, etc)
    return res.status(200).send(userInfos[0]);
  } catch (e) {
    return res.status(500).send({
      error: 'Error fetching account. Please try again later.'
    })
  }
};

export const getAccountById = async (req: Request, res: Response) => {
  try {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen

    // Attempt to fetch the account from the DB
    let accountInfo: AccountDocument = { ...cleanedCosmosAccountInfo };
    if (cleanedCosmosAccountInfo?.cosmosAddress) {
      accountInfo = await ACCOUNTS_DB.get(`${cleanedCosmosAccountInfo.cosmosAddress}`);
    }

    const userInfos = await convertToBitBadgesUserInfo([{ ...accountInfo, ...cleanedCosmosAccountInfo }]); //Newly queried account isw added after bc there may be newer info (sequence, etc)
    return res.status(200).send(userInfos[0]);
  } catch (e) {
    return res.status(500).send({
      error: 'Error fetching account. Please try again later.'
    })
  }
}



//Get by address, cosmosAddress, accountNumber, or username
//ENS names are not supported. Convert to address first
export const getBatchUsers = async (req: Request, res: Response) => {
  try {
    const accountDocuments: AccountDocument[] = [];

    req.body.accountNums = req.body.accountNums.filter((num: number) => num >= 0);
    req.body.addresses = req.body.addresses.filter((address: string) => address.length > 0);

    if (req.body.accountNums && req.body.accountNums.length !== 0) {
      const response = await ACCOUNTS_DB.find({
        selector: {
          accountNumber: {
            $in: req.body.accountNums
          }
        },
        limit: req.body.accountNums.length
      });

      accountDocuments.push(...response.docs);
    }

    if (req.body.addresses && req.body.addresses.length !== 0) {
      const response = await ACCOUNTS_DB.find(
        {
          selector: {
            $or: [
              {
                address: {
                  $in: req.body.addresses
                },
              },
              {
                cosmosAddress: {
                  $in: req.body.addresses
                }
              },
              {
                username: {
                  $in: req.body.addresses
                }
              }
            ]
          },
          limit: req.body.addresses.length
        }
      );
      accountDocuments.push(...response.docs);

      for (const address of req.body.addresses) {
        if (isAddressValid(address) && !accountDocuments.find((account) => account.address === address || account.cosmosAddress === address || account.username === address)) {
          accountDocuments.push({
            address,
            cosmosAddress: convertToCosmosAddress(address),
            username: '',
            accountNumber: -1,
            chain: getChainForAddress(address),
          });
        }
      }
    }

    const userInfos: BitBadgesUserInfo[] = await convertToBitBadgesUserInfo(accountDocuments);
    return res.status(200).send({ accounts: userInfos });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: 'Error fetching accounts. Please try again later.'
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
      accountNumIdx = Number(accountDoc.docs[0].accountNumber);
    }

    let response: nano.MangoResponse<BalanceDocument> = { docs: [] };
    let activityRes: nano.MangoResponse<ActivityItem> = { docs: [] };
    let announcementsRes: nano.MangoResponse<ActivityItem> = { docs: [] };
    let reviewsRes: nano.MangoResponse<ActivityItem> = { docs: [] };

    if (req.body.userActivityBookmark !== undefined) {
      activityRes = await executeActivityQuery(accountNumIdx, userActivityBookmark);
    }

    if (req.body.collectedBookmark !== undefined) {
      response = await executeCollectedQuery(req.params.cosmosAddress, collectedBookmark);
    }

    if (req.body.announcementsBookmark !== undefined) {
      announcementsRes = await executeAnnouncementsQuery(accountNumIdx, announcementsBookmark);
    }

    if (req.body.reviewsBookmark !== undefined) {
      reviewsRes = await executeReviewsQuery(req.params.cosmosAddress, reviewsBookmark);
    }

    return res.status(200).send({
      collected: response.docs,
      activity: activityRes.docs,
      announcements: announcementsRes.docs,
      reviews: reviewsRes.docs,
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

    const accountInfo = await ACCOUNTS_DB.get(cosmosAddress);


    const newAccountInfo: AccountDocument = {
      ...accountInfo,
      discord: req.body.discord ? req.body.discord : accountInfo.discord,
      twitter: req.body.twitter ? req.body.twitter : accountInfo.twitter,
      github: req.body.github ? req.body.github : accountInfo.github,
      telegram: req.body.telegram ? req.body.telegram : accountInfo.telegram,
      seenActivity: req.body.seenActivity ? req.body.seenActivity : accountInfo.seenActivity,
      username: req.body.username ? req.body.username : accountInfo.username,
      readme: req.body.readme ? req.body.readme : accountInfo.readme,
    };

    const regex = /^[a-zA-Z0-9_\-]+$/;
    if (newAccountInfo.username && !regex.test(newAccountInfo.username) && newAccountInfo.username.length > 0) {
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