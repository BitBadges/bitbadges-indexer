
import { cosmosToEth } from "bitbadgesjs-address-converter";
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, AddressMappingDoc, AddressMappingWithMetadata, AnnouncementDoc, AnnouncementInfo, BalanceDoc, BalanceInfoWithDetails, BitBadgesUserInfo, ClaimAlertDoc, ClaimAlertInfo, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsRouteRequestBody, GetAccountsRouteResponse, MINT_ACCOUNT, Metadata, NumberType, PaginationInfo, ProfileDoc, ProfileInfoBase, ReviewDoc, ReviewInfo, Stringify, SupportedChain, TransferActivityDoc, TransferActivityInfo, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertClaimAlertDoc, convertMetadata, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfAuthenticated } from "../blockin/blockin_handlers";
import { FETCHES_DB, PROFILES_DB, insertToDB } from "../db/db";
import { OFFLINE_MODE, client } from "../indexer";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";
import { provider } from "../utils/ensResolvers";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeClaimAlertsQuery, executeCollectedQuery, executeListsQuery, executeReviewsQuery } from "./userHelpers";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers, getAddressMappingsFromDB } from "./utils";


type AccountFetchOptions = GetAccountRouteRequestBody;

export const getAccountByAddress = async (req: Request, address: string, fetchOptions?: AccountFetchOptions) => {
  if (address === 'Mint') return convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify);

  let accountInfo: AccountInfoBase<JSPrimitiveNumberType>;
  if (!OFFLINE_MODE && fetchOptions?.fetchSequence) {
    const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(address);
    if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
    accountInfo = {
      ...cleanedCosmosAccountInfo,
      chain: cleanedCosmosAccountInfo.chain === SupportedChain.UNKNOWN ? getChainForAddress(address) : cleanedCosmosAccountInfo.chain,

    };
  } else {
    console.log(convertToCosmosAddress(address));
    try {
      const cleanedCosmosAccountInfo = await client.badgesQueryClient?.badges.getAccountInfo(address);
      if (!cleanedCosmosAccountInfo) throw new Error('Account not found'); // For TS, should never happen
      accountInfo = {
        ...cleanedCosmosAccountInfo,
        chain: cleanedCosmosAccountInfo.chain === SupportedChain.UNKNOWN ? getChainForAddress(address) : cleanedCosmosAccountInfo.chain,
      };

      //TODO: Switch back to this. Was failing in the case we airdropped (i.e. recipient was address) thus had an account number but was not in ACCOUNTS_DB yet
      // accountInfo = await ACCOUNTS_DB.get(`${convertToCosmosAddress(address)}`);
    } catch (e) {
      if (e.statusCode === 404) {
        let ethTxCount = 0;
        const ethAddress = getChainForAddress(address) === SupportedChain.ETH ? address : cosmosToEth(address);
        if (isAddressValid(address)) {
          console.log("Account not found on chain so returning empty account");
          try {
            const profileDoc = await PROFILES_DB.get(`${convertToCosmosAddress(address)}`).catch(catch404);
            if (profileDoc && profileDoc.latestSignedInChain) {
              if (profileDoc.latestSignedInChain === SupportedChain.ETH) {
                ethTxCount = 1 // just posititve so it triggers the ETH conversion
              }
            } else {
              ethTxCount = await provider.getTransactionCount(ethAddress);
              console.log(ethTxCount);
            }
          } catch (e) {
            console.log("Error fetching tx count", e);
          }
        }

        accountInfo = {
          address: ethTxCount > 0 ? ethAddress : address,
          sequence: "0",
          accountNumber: -1,
          cosmosAddress: convertToCosmosAddress(address),
          chain: ethTxCount > 0 ? SupportedChain.ETH : getChainForAddress(address),
          publicKey: '',
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
    const portfolioRes = await getAdditionalUserInfo(req, account.cosmosAddress, fetchOptions);
    account = {
      ...account,
      ...portfolioRes
    }
  }

  return account;
}

export const getAccountByUsername = async (req: Request, username: string, fetchOptions?: AccountFetchOptions) => {
  const profilesRes = await PROFILES_DB.find({
    selector: {
      username: { "$eq": username },
    },
    limit: 1,
  });

  if (profilesRes.docs.length == 0) {
    return Promise.reject('No doc with username found');
  }

  const profileDoc = profilesRes.docs[0];

  //TODO: Readd fetch sequence option
  // let accountInfo = await ACCOUNTS_DB.get(`${profileDoc._id}`).catch(catch404);
  const accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(profileDoc._id);
  if (!accountInfo) throw new Error('Account not found'); // For TS, should never happen


  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }], fetchName); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];

  if (fetchOptions) {
    //account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(req, account.cosmosAddress, fetchOptions);
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
      account = await getAccountByAddress(req, req.params.addressOrUsername, reqBody);
    } else {
      account = await getAccountByUsername(req, req.params.addressOrUsername, reqBody);
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
        promises.push(getAccountByUsername(req, accountFetchOptions.username, accountFetchOptions));
      }
      else if (accountFetchOptions.address) {
        promises.push(getAccountByAddress(req, accountFetchOptions.address, accountFetchOptions));
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

const getAdditionalUserInfo = async (req: Request, cosmosAddress: string, reqBody: AccountFetchOptions): Promise<{
  collected: BalanceInfoWithDetails<JSPrimitiveNumberType>[],
  activity: TransferActivityInfo<JSPrimitiveNumberType>[],
  announcements: AnnouncementInfo<JSPrimitiveNumberType>[],
  reviews: ReviewInfo<JSPrimitiveNumberType>[],
  addressMappings: AddressMappingWithMetadata<JSPrimitiveNumberType>[],
  claimAlerts: ClaimAlertInfo<JSPrimitiveNumberType>[],
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
    addressMappings: [],
    claimAlerts: [],
    views: {},
  };

  const activityBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestActivity')?.bookmark;
  const collectedBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollected')?.bookmark;
  const announcementsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestAnnouncements')?.bookmark;
  const reviewsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestReviews')?.bookmark;
  const addressMappingsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'addressMappings')?.bookmark;
  const claimAlertsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestClaimAlerts')?.bookmark;


  let response: nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>> = { docs: [] };
  let activityRes: nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>> = { docs: [] };
  let announcementsRes: nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>> = { docs: [] };
  let reviewsRes: nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>> = { docs: [] };
  let addressMappingsRes: nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>> = { docs: [] };
  let claimAlertsRes: nano.MangoResponse<ClaimAlertDoc<JSPrimitiveNumberType>> = { docs: [] };

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

  if (addressMappingsBookmark !== undefined) {
    addressMappingsRes = await executeListsQuery(cosmosAddress, addressMappingsBookmark);
  }

  if (claimAlertsBookmark !== undefined) {
    console.log("CLAIM ALERTS", claimAlertsBookmark);
    const authReq = req as AuthenticatedRequest<NumberType>;
    console.log(authReq.session);
    if (authReq.session && checkIfAuthenticated(authReq)) {
      if (authReq.session.cosmosAddress !== cosmosAddress) {
        throw new Error('You can only fetch claim alerts for your own account.');
      }

      claimAlertsRes = await executeClaimAlertsQuery(cosmosAddress, claimAlertsBookmark);

      console.log(claimAlertsRes);
    } else {
      throw new Error('You must be authenticated to fetch claim alerts.');
    }
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

  let addressMappingsToReturn: AddressMappingWithMetadata<string>[] = [...addressMappingsRes.docs.map(x => x).map(removeCouchDBDetails)];
  let mappingUris: string[] = addressMappingsToReturn.map(x => x.uri);
  if (mappingUris.length > 0) {
    for (const uri of mappingUris) {
      const doc = await FETCHES_DB.get(uri).catch(catch404);
      if (doc) {
        addressMappingsToReturn = addressMappingsToReturn.map(x => {
          if (x.uri === uri) {
            return {
              ...x,
              metadata: convertMetadata(doc.content as Metadata<JSPrimitiveNumberType>, Stringify),
            }
          } else {
            return x;
          }
        })
      }
    }
  }


  return {
    collected: response.docs.map(x => convertBalanceDoc(x, Stringify)).map(removeCouchDBDetails).map((collected) => {
      return {
        ...collected,
        approvedIncomingTransfersTimeline: appendDefaultForIncomingUserApprovedTransfers(collected.approvedIncomingTransfersTimeline, addressMappings, cosmosAddress),
        approvedOutgoingTransfersTimeline: appendDefaultForOutgoingUserApprovedTransfers(collected.approvedOutgoingTransfersTimeline, addressMappings, cosmosAddress),
      };
    }),
    claimAlerts: claimAlertsRes.docs.map(x => convertClaimAlertDoc(x, Stringify)).map(removeCouchDBDetails),
    addressMappings: addressMappingsToReturn,
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
      'addressMappings': reqBody.viewsToFetch.find(x => x.viewKey === 'addressMappings') ? {
        ids: addressMappingsRes.docs.map(x => x._id),
        type: 'Address Mappings',
        pagination: {
          bookmark: addressMappingsRes.bookmark ? addressMappingsRes.bookmark : '',
          hasMore: addressMappingsRes.docs.length === 25
        }
      } : undefined,
      'latestClaimAlerts': reqBody.viewsToFetch.find(x => x.viewKey === 'latestClaimAlerts') ? {
        ids: addressMappingsRes.docs.map(x => x._id),
        type: 'Claim Alerts',
        pagination: {
          bookmark: claimAlertsRes.bookmark ? claimAlertsRes.bookmark : '',
          hasMore: claimAlertsRes.docs.length === 25
        }
      } : undefined,
    }
  }
}


export const updateAccountInfo = async (expressReq: Request, res: Response<UpdateAccountInfoRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>; const reqBody = req.body as UpdateAccountInfoRouteRequestBody<JSPrimitiveNumberType>

    const cosmosAddress = req.session.cosmosAddress;
    let accountInfo: ProfileDoc<JSPrimitiveNumberType> | undefined = await PROFILES_DB.get(cosmosAddress).catch(catch404);
    if (!accountInfo) {
      accountInfo = {
        _id: cosmosAddress,
        _rev: undefined,
      }
    }

    if (reqBody.username) {
      //No . in username allowed
      //Do standard username regex
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(reqBody.username)) {
        return res.status(400).send({
          message: 'Username must be 1 to 15 characters long and can only contain letters, numbers, and underscores.'
        })
      }

      const doc = await PROFILES_DB.find({
        selector: {
          username: { "$eq": reqBody.username },
        },
        limit: 1,
      });
      if (doc.docs.length > 0) {
        return res.status(400).send({
          message: 'Username already taken'
        })
      }
    }

    const newAccountInfo: ProfileDoc<JSPrimitiveNumberType> = {
      ...accountInfo,
      discord: reqBody.discord ?? accountInfo.discord,
      twitter: reqBody.twitter ?? accountInfo.twitter,
      github: reqBody.github ?? accountInfo.github,
      telegram: reqBody.telegram ?? accountInfo.telegram,
      seenActivity: reqBody.seenActivity?.toString() ?? accountInfo.seenActivity,
      readme: reqBody.readme ?? accountInfo.readme,
      showAllByDefault: reqBody.showAllByDefault ?? accountInfo.showAllByDefault,
      shownBadges: reqBody.shownBadges ?? accountInfo.shownBadges,
      hiddenBadges: reqBody.hiddenBadges ?? accountInfo.hiddenBadges,
      customPages: reqBody.customPages ?? accountInfo.customPages,
      profilePicUrl: reqBody.profilePicUrl ?? accountInfo.profilePicUrl,
      username: reqBody.username ?? accountInfo.username,
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