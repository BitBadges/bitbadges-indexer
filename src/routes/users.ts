
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, AnnouncementDoc, BalanceDoc, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsByAddressRouteRequestBody, GetAccountsByAddressRouteResponse, GetActivityForUserRouteResponse, GetActivityRouteRequestBody, GetPortfolioInfoRouteRequestBody, GetPortfolioInfoRouteResponse, ProfileDoc, ProfileInfoBase, ReviewDoc, Stringify, TransferActivityDoc, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { catch404, removeCouchDBDetails } from "src/utils/couchdb-utils";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, PROFILES_DB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeCollectedQuery, executeReviewsQuery } from "./userHelpers";

export const getAccountByAddress = async (address: string, fetchFromBlockchain = false) => {
  let accountInfo: AccountInfoBase<JSPrimitiveNumberType>;
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
  let profileInfo: ProfileInfoBase<JSPrimitiveNumberType> = {}
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
  const accountRes = await ACCOUNTS_DB.find({
    selector: {
      username: { "$eq": username },
    },
    limit: 1,
  });

  if (accountRes.docs.length == 0) {
    return Promise.reject('No doc with username found');
  }

  const accountDoc = accountRes.docs[0];

  let accountInfo: AccountInfoBase<JSPrimitiveNumberType> = accountDoc;
  if (fetchFromBlockchain) {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(accountDoc.cosmosAddress);
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
    accountInfo = {
      ...cleanedCosmosAccountInfo,
      ...accountDoc
    };
  }

  let profileDoc: ProfileInfoBase<JSPrimitiveNumberType> | undefined = undefined;
  try {
    profileDoc = await PROFILES_DB.get(`${accountInfo.cosmosAddress}`);
  } catch (e) {
    if (e.statusCode !== 404) {
      throw e;
    } else {
      profileDoc = {}
    }
  }


  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }]); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  return userInfos[0];
}


export const getAccount = async (req: Request, res: Response<GetAccountRouteResponse>) => {
  try {
    const reqBody = req.body as GetAccountRouteRequestBody;

    const fetchFromBlockchain = reqBody.fetchFromBlockchain;

    if (isAddressValid(req.params.addressOrUsername)) {
      const account = await getAccountByAddress(req.params.addressOrUsername, fetchFromBlockchain);
      return res.status(200).send(convertBitBadgesUserInfo(account, Stringify));
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername, fetchFromBlockchain);
      return res.status(200).send(convertBitBadgesUserInfo(account, Stringify));
    }
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching account. Please try again later."
    })
  }
};

//Get by address, cosmosAddress, accountNumber, or username
//ENS names are not supported. Convert to address first
export const getAccountsByAddress = async (req: Request, res: Response<GetAccountsByAddressRouteResponse>) => {
  try {
    const reqBody = req.body as GetAccountsByAddressRouteRequestBody;
    reqBody.addresses = reqBody.addresses.filter((address: string) => address.length > 0);

    if (reqBody.addresses && reqBody.addresses.length !== 0) {
      const promises = [];
      for (const address of reqBody.addresses) {
        promises.push(getAccountByAddress(address));
      }

      const userInfos = await Promise.all(promises);
      return res.status(200).send({ accounts: userInfos.map(x => convertBitBadgesUserInfo(x, Stringify)) });
    } else {
      return res.status(200).send({ accounts: [] });
    }
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching accounts. Please try again later."
    })
  }
}


export const getPortfolioInfo = async (req: Request, res: Response<GetPortfolioInfoRouteResponse>) => {
  try {
    const reqBody = req.body as GetPortfolioInfoRouteRequestBody;
    const activityBookmark = reqBody.activityBookmark;
    const collectedBookmark = reqBody.collectedBookmark;
    const announcementsBookmark = reqBody.announcementsBookmark;
    const reviewsBookmark = reqBody.reviewsBookmark;
    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }


    let response: nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>> = { docs: [] };
    let activityRes: nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>> = { docs: [] };
    let announcementsRes: nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>> = { docs: [] };
    let reviewsRes: nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>> = { docs: [] };

    if (reqBody.activityBookmark !== undefined) {
      activityRes = await executeActivityQuery(cosmosAddress, activityBookmark);
    }

    if (reqBody.collectedBookmark !== undefined) {
      response = await executeCollectedQuery(req.params.cosmosAddress, collectedBookmark);
    }

    if (reqBody.announcementsBookmark !== undefined) {
      announcementsRes = await executeAnnouncementsQuery(cosmosAddress, announcementsBookmark);
    }

    if (reqBody.reviewsBookmark !== undefined) {
      reviewsRes = await executeReviewsQuery(req.params.cosmosAddress, reviewsBookmark);
    }

    return res.status(200).send({
      collected: response.docs.map(x => convertBalanceDoc(x, Stringify)).map(removeCouchDBDetails),
      activity: activityRes.docs.map(x => convertTransferActivityDoc(x, Stringify)).map(removeCouchDBDetails),
      announcements: announcementsRes.docs.map(x => convertAnnouncementDoc(x, Stringify)).map(removeCouchDBDetails),
      reviews: reviewsRes.docs.map(x => convertReviewDoc(x, Stringify)).map(removeCouchDBDetails),
      pagination: {
        activity: {
          bookmark: activityRes.bookmark ? activityRes.bookmark : '',
          hasMore: activityRes.docs.length === 25
        },
        announcements: {
          bookmark: announcementsRes.bookmark ? announcementsRes.bookmark : '',
          hasMore: announcementsRes.docs.length === 25
        },
        collected: {
          bookmark: response.bookmark ? response.bookmark : '',
          hasMore: response.docs.length === 25
        },
        reviews: {
          bookmark: reviewsRes.bookmark ? reviewsRes.bookmark : '',
          hasMore: reviewsRes.docs.length === 25
        }
      }
    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching portfolio. Please try again later."
    })
  }
}


export const updateAccountInfo = async (expressReq: Request, res: Response<UpdateAccountInfoRouteResponse>) => {
  try {
    const req = expressReq as AuthenticatedRequest
    const reqBody = req.body as UpdateAccountInfoRouteRequestBody;

    const cosmosAddress = req.session.cosmosAddress;
    let accountInfo = await PROFILES_DB.get(cosmosAddress).catch(catch404);
    if (!accountInfo) {
      accountInfo = {
        _id: cosmosAddress,
        _rev: '',
      }
    }

    const newAccountInfo: ProfileDoc<JSPrimitiveNumberType> = {
      ...accountInfo,
      discord: reqBody.discord ? reqBody.discord : accountInfo.discord,
      twitter: reqBody.twitter ? reqBody.twitter : accountInfo.twitter,
      github: reqBody.github ? reqBody.github : accountInfo.github,
      telegram: reqBody.telegram ? reqBody.telegram : accountInfo.telegram,
      seenActivity: reqBody.seenActivity ? BigInt(reqBody.seenActivity).toString() : accountInfo.seenActivity,
      readme: reqBody.readme ? reqBody.readme : accountInfo.readme,
    };

    await insertToDB(PROFILES_DB, newAccountInfo);

    return res.status(200).send(
      { message: 'Account info updated successfully' }
    );
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error updating account info. Please try again later."
    })
  }
}


export const getActivity = async (req: Request, res: Response<GetActivityForUserRouteResponse>) => {
  try {
    const reqBody = req.body as GetActivityRouteRequestBody;

    let cosmosAddress = '';
    if (isAddressValid(req.params.addressOrUsername)) {
      cosmosAddress = convertToCosmosAddress(req.params.addressOrUsername);
    } else {
      const account = await getAccountByUsername(req.params.addressOrUsername);
      cosmosAddress = account.cosmosAddress;
    }

    const activityRes = await executeActivityQuery(cosmosAddress, reqBody.activityBookmark);
    const announcementsRes = await executeAnnouncementsQuery(cosmosAddress, reqBody.announcementsBookmark);

    return res.status(200).send({
      activity: activityRes.docs.map(x => convertTransferActivityDoc(x, Stringify)).map(removeCouchDBDetails),
      announcements: announcementsRes.docs.map(x => convertAnnouncementDoc(x, Stringify)).map(removeCouchDBDetails),
      pagination: {
        activity: {
          bookmark: activityRes.bookmark ? activityRes.bookmark : '',
          hasMore: activityRes.docs.length === 25
        },
        announcements: {
          bookmark: announcementsRes.bookmark ? announcementsRes.bookmark : '',
          hasMore: announcementsRes.docs.length === 25
        }
      }
    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching activity. Please try again later."
    })
  }
}