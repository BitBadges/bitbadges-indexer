
import { cosmosToEth } from "bitbadgesjs-address-converter";
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountDoc, AccountInfoBase, AddressMappingDoc, AddressMappingWithMetadata, AnnouncementDoc, AnnouncementInfo, BalanceDoc, BalanceInfoWithDetails, BitBadgesUserInfo, ClaimAlertDoc, ClaimAlertInfo, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsRouteRequestBody, GetAccountsRouteResponse, MINT_ACCOUNT, NumberType, PaginationInfo, ProfileDoc, ProfileInfoBase, ReviewDoc, ReviewInfo, Stringify, SupportedChain, TransferActivityDoc, TransferActivityInfo, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAddressMappingWithMetadata, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertClaimAlertDoc, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { CleanedCosmosAccountInformation } from "src/chain-client/queries";
import { AuthenticatedRequest, checkIfAuthenticated } from "../blockin/blockin_handlers";
import { ACCOUNTS_DB, PROFILES_DB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { catch404, getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { provider } from "../utils/ensResolvers";
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeClaimAlertsQuery, executeCollectedQuery, executeListsQuery, executeReviewsQuery } from "./userHelpers";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers, getAddressMappingsFromDB } from "./utils";


type AccountFetchOptions = GetAccountRouteRequestBody;

async function getBatchAccountInformation(queries: { address: string, fetchOptions?: AccountFetchOptions }[]) {
  const accountInfos: AccountInfoBase<JSPrimitiveNumberType>[] = [];
  const addressesToFetchWithSequence = queries.filter(x => x.fetchOptions?.fetchSequence).map(x => x.address);
  const addressesToFetchWithoutSequence = queries.filter(x => !x.fetchOptions?.fetchSequence).map(x => x.address);

  const promises = [];
  for (const address of addressesToFetchWithSequence) {
    promises.push(client.badgesQueryClient?.badges.getAccountInfo(address));
  }
  if (addressesToFetchWithoutSequence.length > 0) promises.push(ACCOUNTS_DB.fetch({ keys: addressesToFetchWithoutSequence }, { include_docs: true }));
  const results = await Promise.all(promises);

  for (let i = 0; i < addressesToFetchWithSequence.length; i++) {
    let result = results[i] as CleanedCosmosAccountInformation;
    result = {
      ...result,
      chain: result.chain === SupportedChain.UNKNOWN ? getChainForAddress(addressesToFetchWithSequence[i]) : result.chain,
    };
    accountInfos.push(result);
  }

  if (addressesToFetchWithoutSequence.length > 0) {
    const fetchResult = results[addressesToFetchWithSequence.length] as nano.DocumentFetchResponse<AccountDoc<JSPrimitiveNumberType>>;
    const docs = getDocsFromNanoFetchRes(fetchResult, true);

    const resolveChainPromises = [];
    for (const address of addressesToFetchWithoutSequence) {
      const doc = docs.find(x => x._id === convertToCosmosAddress(address));
      if (doc) {
        accountInfos.push(doc);
      } else {

        resolveChainPromises.push(async () => {
          let ethTxCount = 0;
          const ethAddress = getChainForAddress(address) === SupportedChain.ETH ? address : cosmosToEth(address);
          if (isAddressValid(address)) {
            try {
              const profileDoc = await PROFILES_DB.get(`${convertToCosmosAddress(address)}`).catch(catch404);
              if (profileDoc && profileDoc.latestSignedInChain) {
                if (profileDoc.latestSignedInChain === SupportedChain.ETH) {
                  ethTxCount = 1 // just posititve so it triggers the ETH conversion
                }
              } else {
                ethTxCount = await provider.getTransactionCount(ethAddress);
              }
            } catch (e) {
              console.log("Error fetching tx count", e);
            }
          }


          return {
            address: ethTxCount > 0 ? ethAddress : address,
            sequence: "0",
            accountNumber: -1,
            cosmosAddress: convertToCosmosAddress(address),
            chain: ethTxCount > 0 ? SupportedChain.ETH : getChainForAddress(address),
            publicKey: '',
          }
        });

      }
    }
    if (resolveChainPromises.length > 0) {
      const resolvedChainResults = await Promise.all(resolveChainPromises.map(x => x()));
      accountInfos.push(...resolvedChainResults);
    }
  }
  return accountInfos;
}

async function getBatchProfileInformation(queries: { address: string, fetchOptions?: AccountFetchOptions }[]) {
  const profileInfos: ProfileInfoBase<JSPrimitiveNumberType>[] = [];
  const addressesToFetch = queries.map(x => convertToCosmosAddress(x.address));

  if (addressesToFetch.length === 0) return addressesToFetch.map(x => ({}));

  const fetchResult = await PROFILES_DB.fetch({ keys: addressesToFetch }, { include_docs: true });
  const docs = getDocsFromNanoFetchRes(fetchResult, true);

  for (const address of addressesToFetch) {
    const doc = docs.find(x => x._id === address);
    if (doc) {
      profileInfos.push(doc);
    } else {
      profileInfos.push({});
    }
  }

  return profileInfos;
}



export const getAccountByAddress = async (req: Request, address: string, fetchOptions?: AccountFetchOptions) => {
  if (address === 'Mint') return convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify);
  let accountInfo = (await getBatchAccountInformation([{ address, fetchOptions }]))[0];
  let profileInfo = (await getBatchProfileInformation([{ address, fetchOptions }]))[0];

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

const resolveUsernames = async (usernames: string[]) => {
  const promises = [];
  for (const username of usernames) {
    promises.push(PROFILES_DB.find({
      selector: {
        username: { "$eq": username },
      },
      limit: 1,
    }));
  }

  const results = await Promise.all(promises);
  const docs = results.map(x => x.docs[0]);

  return docs;
}



export const getAccountByUsername = async (req: Request, username: string, fetchOptions?: AccountFetchOptions) => {
  const profilesRes = await resolveUsernames([username]);
  const profileDoc = profilesRes[0];

  const accountInfo = (await getBatchAccountInformation([{ address: profileDoc._id, fetchOptions }]))[0];

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

    const usernames = reqBody.accountsToFetch.filter(x => x.username).map(x => x.username).filter(x => x !== undefined) as string[];
    const profileDocs = await resolveUsernames(usernames);

    const allQueries = profileDocs.map(x => { return { address: x._id, fetchOptions: reqBody.accountsToFetch.find(y => y.username === x.username) } });

    for (const accountFetchOptions of reqBody.accountsToFetch) {
      if (accountFetchOptions.address) {
        allQueries.push({ address: accountFetchOptions.address, fetchOptions: accountFetchOptions });
      }
    }

    const accountInfos = await getBatchAccountInformation(allQueries);
    const profileInfos = await getBatchProfileInformation(allQueries);
    const userInfos = await convertToBitBadgesUserInfo(profileInfos, accountInfos, !allDoNotHaveExternalCalls);

    const additionalInfoPromises = [];
    for (const query of allQueries) {
      if (query.fetchOptions) {
        let idx = userInfos.findIndex(x => query.address ? x.cosmosAddress === convertToCosmosAddress(query.address) : x.username === query.fetchOptions?.username);
        if (idx === -1) {
          throw new Error('Could not find account');
        }
        let account = userInfos[idx];

        additionalInfoPromises.push(getAdditionalUserInfo(req, account.cosmosAddress, query.fetchOptions));
      }
    }


    const additionalInfos = await Promise.all(additionalInfoPromises);
    for (const query of allQueries) {
      if (query.fetchOptions) {
        let idx = userInfos.findIndex(x => query.address ? x.cosmosAddress === convertToCosmosAddress(query.address) : x.username === query.fetchOptions?.username);
        if (idx === -1) {
          throw new Error('Could not find account');
        }
        let account = userInfos[idx];

        userInfos[idx] = {
          ...account,
          ...additionalInfos[idx]
        }
      }
    }

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

  const asyncOperations = [];
  if (collectedBookmark !== undefined) {
    asyncOperations.push(() => executeCollectedQuery(cosmosAddress, collectedBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (activityBookmark !== undefined) {
    asyncOperations.push(() => executeActivityQuery(cosmosAddress, activityBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }



  if (announcementsBookmark !== undefined) {
    asyncOperations.push(() => executeAnnouncementsQuery(cosmosAddress, announcementsBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (reviewsBookmark !== undefined) {
    asyncOperations.push(() => executeReviewsQuery(cosmosAddress, reviewsBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (addressMappingsBookmark !== undefined) {
    asyncOperations.push(() => executeListsQuery(cosmosAddress, addressMappingsBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (claimAlertsBookmark !== undefined) {
    const authReq = req as AuthenticatedRequest<NumberType>;
    if (authReq.session && checkIfAuthenticated(authReq)) {
      if (authReq.session.cosmosAddress !== cosmosAddress) {
        throw new Error('You can only fetch claim alerts for your own account.');
      }

      asyncOperations.push(() => executeClaimAlertsQuery(cosmosAddress, claimAlertsBookmark));
    } else {
      throw new Error('You must be authenticated to fetch claim alerts.');
    }

  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }
  const results = await Promise.all(asyncOperations.map(operation => operation()));
  const response = results[0] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
  const activityRes = results[1] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
  const announcementsRes = results[2] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
  const reviewsRes = results[3] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
  const addressMappingsRes = results[4] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
  const claimAlertsRes = results[5] as nano.MangoResponse<ClaimAlertDoc<JSPrimitiveNumberType>>;

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

  const addressMappingsToReturn = await getAddressMappingsFromDB(addressMappingIdsToFetch, true);
  return {
    collected: response.docs.map(x => convertBalanceDoc(x, Stringify)).map(removeCouchDBDetails).map((collected) => {
      return {
        ...collected,
        approvedIncomingTransfersTimeline: appendDefaultForIncomingUserApprovedTransfers(collected.approvedIncomingTransfersTimeline, addressMappingsToReturn, cosmosAddress),
        approvedOutgoingTransfersTimeline: appendDefaultForOutgoingUserApprovedTransfers(collected.approvedOutgoingTransfersTimeline, addressMappingsToReturn, cosmosAddress),
      };
    }),
    claimAlerts: claimAlertsRes.docs.map(x => convertClaimAlertDoc(x, Stringify)).map(removeCouchDBDetails),
    addressMappings: addressMappingsToReturn.map(x => convertAddressMappingWithMetadata(x, Stringify)),
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