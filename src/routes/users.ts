
import { convertToCosmosAddress, getChainForAddress, isAddressValid, s_Account, s_ActivityItem, s_BalanceDocument, s_Profile } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, PROFILES_DB } from "../db/db";
import { client } from "../indexer";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeCollectedQuery, executeReviewsQuery } from "./userHelpers";


export const getAccountByAddress = async (address: string, fetchFromBlockchain = false) => {
  let accountInfo: s_Account;
  if (fetchFromBlockchain) {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(convertToCosmosAddress(address));
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
    accountInfo = cleanedCosmosAccountInfo;
  } else {
    try {
      accountInfo = await ACCOUNTS_DB.get(`${convertToCosmosAddress(address)}`);
    } catch (e) {
      if (e.statusCode === 404) {
        accountInfo = {
          cosmosAddress: convertToCosmosAddress(address),
          address: address,
          chain: getChainForAddress(address),
          publicKey: '',
        }
      }
      throw e;
    }
  }


  // Attempt to fetch the account from the DB
  let profileInfo: s_Profile = {}
  if (accountInfo?.cosmosAddress) {
    try {
      profileInfo = await PROFILES_DB.get(`${accountInfo.cosmosAddress}`);
    } catch (e) {
      if (e.statusCode !== 404) {
        throw e;
      }
    }
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileInfo }], [{ ...accountInfo }]); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  return userInfos[0];
}

export const getAccountByUsername = async (username: string, fetchFromBlockchain = false) => {
  const profileRes = await PROFILES_DB.find({
    selector: {
      username: { "$eq": username },
    },
    limit: 1,
  });

  if (profileRes.docs.length == 0) {
    return Promise.reject('No doc with username found');
  }

  const profileDoc = profileRes.docs[0];

  let accountInfo: s_Account;
  if (fetchFromBlockchain) {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(profileDoc._id);
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
    accountInfo = cleanedCosmosAccountInfo;
  } else {
    try {
      accountInfo = await ACCOUNTS_DB.get(`${profileDoc._id}`);
    } catch (e) {
      if (e.statusCode === 404) {
        accountInfo = {
          cosmosAddress: profileDoc._id,
          address: profileDoc._id,
          chain: getChainForAddress(profileDoc._id),
          publicKey: '',
        }
      }
      throw e;
    }
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }]); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  return userInfos[0];
}


export const getAccount = async (req: Request, res: Response) => {
  try {
    const fetchFromBlockchain = req.query.fetchFromBlockchain === 'true';

    if (isAddressValid(req.params.addressOrUsername)) {
      return res.status(200).send(await getAccountByAddress(req.params.addressOrUsername, fetchFromBlockchain));
    } else {
      return res.status(200).send(await getAccountByUsername(req.params.addressOrUsername, fetchFromBlockchain));
    }
  } catch (e) {
    return res.status(500).send({
      error: 'Error fetching account. Please try again later.'
    })
  }
};

//Get by address, cosmosAddress, accountNumber, or username
//ENS names are not supported. Convert to address first
export const getAccountsByAddress = async (req: Request, res: Response) => {
  try {
    req.body.addresses = req.body.addresses.filter((address: string) => address.length > 0);

    if (req.body.addresses && req.body.addresses.length !== 0) {
      const promises = [];
      for (const address of req.body.addresses) {
        promises.push(getAccountByAddress(address));
      }

      const userInfos = await Promise.all(promises);
      return res.status(200).send({ accounts: userInfos });
    } else {
      return res.status(200).send({ accounts: [] });
    }
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
    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }


    let response: nano.MangoResponse<s_BalanceDocument> = { docs: [] };
    let activityRes: nano.MangoResponse<s_ActivityItem> = { docs: [] };
    let announcementsRes: nano.MangoResponse<s_ActivityItem> = { docs: [] };
    let reviewsRes: nano.MangoResponse<s_ActivityItem> = { docs: [] };

    if (req.body.userActivityBookmark !== undefined) {
      activityRes = await executeActivityQuery(cosmosAddress, userActivityBookmark);
    }

    if (req.body.collectedBookmark !== undefined) {
      response = await executeCollectedQuery(req.params.cosmosAddress, collectedBookmark);
    }

    if (req.body.announcementsBookmark !== undefined) {
      announcementsRes = await executeAnnouncementsQuery(cosmosAddress, announcementsBookmark);
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
    let accountInfo: s_Profile & nano.Document;
    try {
      accountInfo = await PROFILES_DB.get(cosmosAddress);
    } catch (e) {
      if (e.statusCode === 404) {
        accountInfo = {
          _id: cosmosAddress,
          _rev: '',
        }
      }
      throw e;
    }

    const newAccountInfo: s_Profile = {
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

    await PROFILES_DB.insert(newAccountInfo);

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
    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }

    const activityRes = await executeActivityQuery((cosmosAddress));
    const announcementsRes = await executeAnnouncementsQuery((cosmosAddress));

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