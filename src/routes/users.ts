
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, AnnouncementDoc, AnnouncementInfo, BalanceDoc, BalanceInfoWithDetails, BitBadgesUserInfo, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsRouteRequestBody, GetAccountsRouteResponse, NumberType, PaginationInfo, ProfileDoc, ProfileInfoBase, ReviewDoc, ReviewInfo, Stringify, SupportedChain, TransferActivityDoc, TransferActivityInfo, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, PROFILES_DB, insertToDB } from "../db/db";
import { OFFLINE_MODE, client } from "../indexer";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeCollectedQuery, executeReviewsQuery } from "./userHelpers";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers, getAddressMappingsFromDB } from "./utils";


type AccountFetchOptions = GetAccountRouteRequestBody;

export const getAccountByAddress = async (address: string, fetchOptions?: AccountFetchOptions) => {
  let accountInfo: AccountInfoBase<JSPrimitiveNumberType>;
  if (!OFFLINE_MODE && fetchOptions?.fetchSequence) {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(convertToCosmosAddress(address));
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
    accountInfo = {
      ...cleanedCosmosAccountInfo,
      chain: cleanedCosmosAccountInfo.chain === SupportedChain.UNKNOWN ? getChainForAddress(address) : cleanedCosmosAccountInfo.chain,

    };
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
          accountNumber: -1,
        }
      } else {
        throw e;
      }
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

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileInfo }], [{ ...accountInfo }], fetchName); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];
  if (fetchOptions) {
    //account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(account.cosmosAddress, fetchOptions);
    account = {
      ...account,
      ...portfolioRes
    }
  }

  return account;
}

export const getAccountByUsername = async (username: string, fetchOptions?: AccountFetchOptions) => {
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
  let fetchSequence = fetchOptions?.fetchSequence;
  if (fetchSequence) {
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

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }], fetchName); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];

  if (fetchOptions) {
    //account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(account.cosmosAddress, fetchOptions);
    account = {
      ...account,
      ...portfolioRes
    }
  }

  return account;
}


export const getAccount = async (req: Request, res: Response<GetAccountRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetAccountRouteRequestBody;

    let account: BitBadgesUserInfo<JSPrimitiveNumberType>;
    if (isAddressValid(req.params.addressOrUsername)) {
      account = await getAccountByAddress(req.params.addressOrUsername, reqBody);
    } else {
      account = await getAccountByUsername(req.params.addressOrUsername, reqBody);
    }

    return res.status(200).send(convertBitBadgesUserInfo(account, Stringify));
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching account. Please try again later."
    })
  }
};

//Get by address, cosmosAddress, accountNumber, or username
//ENS names are not supported. Convert to address first
export const getAccounts = async (req: Request, res: Response<GetAccountsRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetAccountsRouteRequestBody;
    const allDoNotHaveExternalCalls = reqBody.accountsToFetch.every(x => x.noExternalCalls);

    if (!allDoNotHaveExternalCalls && reqBody.accountsToFetch.length > 250) {
      return res.status(400).send({
        message: 'You can only fetch up to 250 accounts with external calls at a time. Please structure your request accordingly.'
      })
    } else if (allDoNotHaveExternalCalls && reqBody.accountsToFetch.length > 10000) {
      return res.status(400).send({
        message: 'You can only fetch up to 10,000 accounts without external calls at a time. Please structure your request accordingly.'
      })
    }
    // console.log(req.body.accountsToFetch);

    const promises = [];

    for (const accountFetchOptions of reqBody.accountsToFetch) {
      if (accountFetchOptions.username) {
        promises.push(getAccountByUsername(accountFetchOptions.username, accountFetchOptions));
      }
      else if (accountFetchOptions.address) {
        promises.push(getAccountByAddress(accountFetchOptions.address, accountFetchOptions));
      }
    }
    const userInfos = await Promise.all(promises);
    return res.status(200).send({ accounts: userInfos.map(x => convertBitBadgesUserInfo(x, Stringify)) });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching accounts. Please try again later."
    })
  }
}

const getAdditionalUserInfo = async (cosmosAddress: string, reqBody: AccountFetchOptions): Promise<{
  collected: BalanceInfoWithDetails<JSPrimitiveNumberType>[],
  activity: TransferActivityInfo<JSPrimitiveNumberType>[],
  announcements: AnnouncementInfo<JSPrimitiveNumberType>[],
  reviews: ReviewInfo<JSPrimitiveNumberType>[],
  views: {
    [viewKey: string]: {
      ids: string[],
      type: string,
      pagination: PaginationInfo,
    } | undefined
  }
}> => {
  if (!reqBody.viewsToFetch) return {
    collected: [],
    activity: [],
    announcements: [],
    reviews: [],
    views: {},
  };

  const activityBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestActivity')?.bookmark;
  const collectedBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollected')?.bookmark;
  const announcementsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestAnnouncements')?.bookmark;
  const reviewsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestReviews')?.bookmark;


  let response: nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>> = { docs: [] };
  let activityRes: nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>> = { docs: [] };
  let announcementsRes: nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>> = { docs: [] };
  let reviewsRes: nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>> = { docs: [] };

  if (activityBookmark !== undefined) {
    activityRes = await executeActivityQuery(cosmosAddress, activityBookmark);
  }

  if (collectedBookmark !== undefined) {
    response = await executeCollectedQuery(cosmosAddress, collectedBookmark);
  }

  if (announcementsBookmark !== undefined) {
    announcementsRes = await executeAnnouncementsQuery(cosmosAddress, announcementsBookmark);
  }

  if (reviewsBookmark !== undefined) {
    reviewsRes = await executeReviewsQuery(cosmosAddress, reviewsBookmark);
  }

  let addressMappingIdsToFetch: { collectionId: NumberType; mappingId: string }[] = [];

  for (const balance of response.docs) {
    for (const incomingTimeline of balance.approvedIncomingTransfersTimeline) {
      for (const incoming of incomingTimeline.approvedIncomingTransfers) {
        addressMappingIdsToFetch.push({ mappingId: incoming.fromMappingId, collectionId: balance.collectionId });
        addressMappingIdsToFetch.push({ mappingId: incoming.initiatedByMappingId, collectionId: balance.collectionId });
      }
    }

    for (const outgoingTimeline of balance.approvedOutgoingTransfersTimeline) {
      for (const outgoing of outgoingTimeline.approvedOutgoingTransfers) {
        addressMappingIdsToFetch.push({ mappingId: outgoing.toMappingId, collectionId: balance.collectionId });
        addressMappingIdsToFetch.push({ mappingId: outgoing.initiatedByMappingId, collectionId: balance.collectionId });
      }
    }
  }

  const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch);


  return {
    collected: response.docs.map(x => convertBalanceDoc(x, Stringify)).map(removeCouchDBDetails).map((collected) => {
      return {
        ...collected,
        approvedIncomingTransfersTimeline: appendDefaultForIncomingUserApprovedTransfers(collected.approvedIncomingTransfersTimeline, addressMappings, cosmosAddress),
        approvedOutgoingTransfersTimeline: appendDefaultForOutgoingUserApprovedTransfers(collected.approvedOutgoingTransfersTimeline, addressMappings, cosmosAddress),
      };
    }),


    activity: activityRes.docs.map(x => convertTransferActivityDoc(x, Stringify)).map(removeCouchDBDetails),
    announcements: announcementsRes.docs.map(x => convertAnnouncementDoc(x, Stringify)).map(removeCouchDBDetails),
    reviews: reviewsRes.docs.map(x => convertReviewDoc(x, Stringify)).map(removeCouchDBDetails),
    views: {
      'latestActivity': reqBody.viewsToFetch.find(x => x.viewKey === 'latestActivity') ? {
        ids: activityRes.docs.map(x => x._id),
        type: 'Activity',
        pagination: {
          bookmark: activityRes.bookmark ? activityRes.bookmark : '',
          hasMore: activityRes.docs.length === 25
        }
      } : undefined,
      'badgesCollected': reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollected') ? {
        ids: response.docs.map(x => x._id),
        type: 'Balances',
        pagination: {
          bookmark: response.bookmark ? response.bookmark : '',
          hasMore: response.docs.length === 25
        }
      } : undefined,
      'latestAnnouncements': reqBody.viewsToFetch.find(x => x.viewKey === 'latestAnnouncements') ? {
        ids: announcementsRes.docs.map(x => x._id),
        type: 'Announcements',
        pagination: {
          bookmark: announcementsRes.bookmark ? announcementsRes.bookmark : '',
          hasMore: announcementsRes.docs.length === 25
        }
      } : undefined,
      'latestReviews': reqBody.viewsToFetch.find(x => x.viewKey === 'latestReviews') ? {
        ids: reviewsRes.docs.map(x => x._id),
        type: 'Reviews',
        pagination: {
          bookmark: reviewsRes.bookmark ? reviewsRes.bookmark : '',
          hasMore: reviewsRes.docs.length === 25
        }
      } : undefined,
    }
  }
}


export const updateAccountInfo = async (expressReq: Request, res: Response<UpdateAccountInfoRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest
    const reqBody = req.body as UpdateAccountInfoRouteRequestBody;

    const cosmosAddress = req.session.cosmosAddress;
    let accountInfo: ProfileDoc<JSPrimitiveNumberType> | undefined = await PROFILES_DB.get(cosmosAddress).catch(catch404);
    if (!accountInfo) {
      accountInfo = {
        _id: cosmosAddress,
        _rev: undefined,
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
    console.log("Error updating account info", e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error updating account info. Please try again later."
    })
  }
}