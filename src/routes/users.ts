
import { ObjectCannedACL, PutObjectCommand } from "@aws-sdk/client-s3";
import { BigIntify, JSPrimitiveNumberType, SupportedChain } from "bitbadgesjs-proto";
import { AccountDoc, AccountInfoBase, AddressMappingDoc, AddressMappingWithMetadata, AnnouncementDoc, BalanceDoc, BalanceDocWithDetails, BitBadgesUserInfo, BlockinAuthSignatureDoc, ClaimAlertDoc, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsRouteRequestBody, GetAccountsRouteResponse, MINT_ACCOUNT, NumberType, PaginationInfo, ProfileDoc, ProfileInfoBase, ReviewDoc, Stringify, TransferActivityDoc, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAddressMappingWithMetadata, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertBlockinAuthSignatureDoc, convertClaimAlertDoc, convertProfileDoc, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, cosmosToEth, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfAuthenticated } from "../blockin/blockin_handlers";
import { CleanedCosmosAccountInformation } from "../chain-client/queries";
import { AccountModel, MongoDB, ProfileModel, UsernameModel, deleteMany, getFromDB, getManyFromDB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { s3 } from "../indexer-vars";
import { applyAddressMappingsToUserPermissions } from './balances';
import { convertToBitBadgesUserInfo, executeActivityQuery, executeAnnouncementsQuery, executeAuthCodesQuery, executeClaimAlertsQuery, executeCollectedQuery, executeCreatedByQuery, executeCreatedListsQuery, executeExplicitExcludedListsQuery, executeExplicitIncludedListsQuery, executeLatestAddressMappingsQuery, executeListsQuery, executeManagingQuery, executePrivateListsQuery, executeReviewsQuery } from "./userHelpers";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";

type AccountFetchOptions = GetAccountRouteRequestBody;

async function getBatchAccountInformation(queries: { address: string, fetchOptions?: AccountFetchOptions }[]) {
  const accountInfos: AccountInfoBase<JSPrimitiveNumberType>[] = [];
  const addressesToFetchWithSequence = queries.filter(x => x.fetchOptions?.fetchSequence).map(x => x.address);
  const addressesToFetchWithoutSequence = queries.filter(x => !x.fetchOptions?.fetchSequence).map(x => x.address);

  const promises = [];
  for (const address of addressesToFetchWithSequence) {
    promises.push(client.badgesQueryClient?.badges.getAccountInfo(address));
  }
  if (addressesToFetchWithoutSequence.length > 0) promises.push(getManyFromDB(AccountModel, addressesToFetchWithoutSequence.map(x => convertToCosmosAddress(x))));
  const results = await Promise.all(promises);

  for (let i = 0; i < addressesToFetchWithSequence.length; i++) {
    let result = results[i] as CleanedCosmosAccountInformation;
    accountInfos.push({
      ...result,
      solAddress: getChainForAddress(addressesToFetchWithSequence[i]) === SupportedChain.SOLANA ? addressesToFetchWithSequence[i] : '',
    });
  }

  if (addressesToFetchWithoutSequence.length > 0) {
    const docs = results[addressesToFetchWithSequence.length] as (AccountDoc<JSPrimitiveNumberType> | undefined)[];
    for (const address of addressesToFetchWithoutSequence) {
      const doc = docs.find(x => x && x._legacyId === convertToCosmosAddress(address));
      if (doc) {
        accountInfos.push({
          ...doc,
          solAddress: getChainForAddress(address) === SupportedChain.SOLANA ? address : '',
        });
      } else {
        accountInfos.push({
          cosmosAddress: convertToCosmosAddress(address),
          solAddress: getChainForAddress(address) === SupportedChain.SOLANA ? address : '',
          ethAddress: cosmosToEth(convertToCosmosAddress(address)),
          sequence: 0,
          accountNumber: -1,
          chain: getChainForAddress(address), //By default, if we do not have an account doc yet, we use the requested format
          publicKey: '',
        });
      }
    }
  }

  return accountInfos;
}

async function getBatchProfileInformation(queries: { address: string, fetchOptions?: AccountFetchOptions }[]) {
  const profileInfos: ProfileInfoBase<JSPrimitiveNumberType>[] = [];
  const addressesToFetch = queries.map(x => convertToCosmosAddress(x.address));

  if (addressesToFetch.length === 0) return addressesToFetch.map(x => ({}));

  const docs = await getManyFromDB(ProfileModel, addressesToFetch);

  for (const address of addressesToFetch) {
    const doc = docs.find(x => x && x._legacyId === address);
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
    const portfolioRes = await getAdditionalUserInfo(req, {
      ...profileInfo,
      _legacyId: convertToCosmosAddress(address),
    }, account.cosmosAddress, fetchOptions);
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
    promises.push(ProfileModel.find({
      username: username
    }).limit(1).lean().exec())
  }

  const results = await Promise.all(promises);
  const docs = results.map(x => x[0]);

  return docs;
}



export const getAccountByUsername = async (req: Request, username: string, fetchOptions?: AccountFetchOptions) => {
  const profilesRes = await resolveUsernames([username]);
  const profileDoc = profilesRes[0];

  const accountInfo = (await getBatchAccountInformation([{ address: profileDoc._legacyId, fetchOptions }]))[0];

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }], fetchName); //Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];

  if (fetchOptions) {
    //account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(req, {
      ...convertProfileDoc(profileDoc, BigIntify),
      _legacyId: convertToCosmosAddress(profileDoc._legacyId),
    }, account.cosmosAddress, fetchOptions);
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
    const allQueries = profileDocs.map(x => { return { address: x._legacyId, fetchOptions: reqBody.accountsToFetch.find(y => y.username === x.username) } });

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

        additionalInfoPromises.push(getAdditionalUserInfo(req, {
          ...convertProfileDoc({
            _legacyId: convertToCosmosAddress(account.cosmosAddress),
            ...profileInfos[idx]
          }, BigIntify),
        }, account.cosmosAddress, query.fetchOptions));
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

const getAdditionalUserInfo = async (req: Request, profileInfo: ProfileDoc<bigint>, cosmosAddress: string, reqBody: AccountFetchOptions): Promise<{
  collected: BalanceDocWithDetails<JSPrimitiveNumberType>[],
  activity: TransferActivityDoc<JSPrimitiveNumberType>[],
  announcements: AnnouncementDoc<JSPrimitiveNumberType>[],
  reviews: ReviewDoc<JSPrimitiveNumberType>[],
  addressMappings: AddressMappingWithMetadata<JSPrimitiveNumberType>[],
  claimAlerts: ClaimAlertDoc<JSPrimitiveNumberType>[],
  authCodes: BlockinAuthSignatureDoc<JSPrimitiveNumberType>[],
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
    authCodes: [],
    views: {},
  };

  const activityBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestActivity')?.bookmark;
  const collectedBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollected')?.bookmark;
  const collectedWithHiddenBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollectedWithHidden')?.bookmark;
  const announcementsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestAnnouncements')?.bookmark;
  const reviewsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestReviews')?.bookmark;
  const addressMappingsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'addressMappings')?.bookmark;
  const claimAlertsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'latestClaimAlerts')?.bookmark;
  const explicitIncludedAddressMappings = reqBody.viewsToFetch.find(x => x.viewKey === 'explicitlyIncludedAddressMappings')?.bookmark;
  const explicitExcludedAddressMappings = reqBody.viewsToFetch.find(x => x.viewKey === 'explicitlyExcludedAddressMappings')?.bookmark;
  const latestAddressMappings = reqBody.viewsToFetch.find(x => x.viewKey === 'latestAddressMappings')?.bookmark;
  const managingBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'managing')?.bookmark;
  const createdByBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'createdBy')?.bookmark;
  const authCodesBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'authCodes')?.bookmark;
  const privateListsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'privateLists')?.bookmark;
  const createdListsBookmark = reqBody.viewsToFetch.find(x => x.viewKey === 'createdLists')?.bookmark;

  const asyncOperations = [];
  if (collectedBookmark !== undefined) {
    asyncOperations.push(() => executeCollectedQuery(cosmosAddress, profileInfo, false, collectedBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (collectedWithHiddenBookmark !== undefined) {
    asyncOperations.push(() => executeCollectedQuery(cosmosAddress, profileInfo, true, collectedWithHiddenBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (activityBookmark !== undefined) {
    asyncOperations.push(() => executeActivityQuery(cosmosAddress, profileInfo, false, activityBookmark));
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

  if (explicitIncludedAddressMappings !== undefined) {
    asyncOperations.push(() => executeExplicitIncludedListsQuery(cosmosAddress, explicitIncludedAddressMappings));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (explicitExcludedAddressMappings !== undefined) {
    asyncOperations.push(() => executeExplicitExcludedListsQuery(cosmosAddress, explicitExcludedAddressMappings));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (latestAddressMappings !== undefined) {
    asyncOperations.push(() => executeLatestAddressMappingsQuery(cosmosAddress, latestAddressMappings));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (managingBookmark !== undefined) {
    asyncOperations.push(() => executeManagingQuery(cosmosAddress, profileInfo, managingBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (createdByBookmark !== undefined) {
    asyncOperations.push(() => executeCreatedByQuery(cosmosAddress, profileInfo, createdByBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (authCodesBookmark !== undefined) {
    const authReq = req as AuthenticatedRequest<NumberType>;
    if (authReq.session && checkIfAuthenticated(authReq)) {
      if (authReq.session.cosmosAddress !== cosmosAddress) {
        throw new Error('You can only fetch auth codes for your own account.');
      }

      asyncOperations.push(() => executeAuthCodesQuery(cosmosAddress, authCodesBookmark));
    } else {
      throw new Error('You must be authenticated to fetch auth codes.');
    }

  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (privateListsBookmark !== undefined) {
    const authReq = req as AuthenticatedRequest<NumberType>;
    if (authReq.session && checkIfAuthenticated(authReq)) {
      if (authReq.session.cosmosAddress !== cosmosAddress) {
        throw new Error('You can only fetch auth codes for your own account.');
      }

      asyncOperations.push(() => executePrivateListsQuery(cosmosAddress, privateListsBookmark));
    } else {
      throw new Error('You must be authenticated to fetch private lists.');
    }

  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }

  if (createdListsBookmark !== undefined) {
    asyncOperations.push(() => executeCreatedListsQuery(cosmosAddress, createdListsBookmark));
  } else {
    asyncOperations.push(() => Promise.resolve({ docs: [] }));
  }


  const results = await Promise.all(asyncOperations.map(operation => operation()));
  const response = results[0] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
  const responseWithHidden = results[1] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
  const activityRes = results[2] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
  const announcementsRes = results[3] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
  const reviewsRes = results[4] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
  const addressMappingsRes = results[5] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
  const claimAlertsRes = results[6] as nano.MangoResponse<ClaimAlertDoc<JSPrimitiveNumberType>>;
  const explicitIncludedAddressMappingsRes = results[7] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
  const explicitExcludedAddressMappingsRes = results[8] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
  const latestAddressMappingsRes = results[9] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;

  const managingRes = results[10] as any
  const createdByRes = results[11] as any
  const authCodesRes = results[12] as nano.MangoResponse<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>;
  const privateListsRes = results[13] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
  const createdListsRes = results[14] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;

  const addressMappingIdsToFetch: { collectionId?: NumberType; mappingId: string }[] = [
    ...addressMappingsRes.docs.map(x => ({ mappingId: x.mappingId })),
    ...explicitIncludedAddressMappingsRes.docs.map(x => ({ mappingId: x.mappingId })),
    ...explicitExcludedAddressMappingsRes.docs.map(x => ({ mappingId: x.mappingId })),
    ...latestAddressMappingsRes.docs.map(x => ({ mappingId: x.mappingId })),
    ...privateListsRes.docs.map(x => ({ mappingId: x.mappingId })),
    ...createdListsRes.docs.map(x => ({ mappingId: x.mappingId })),
  ];

  for (const balance of [...response.docs, ...responseWithHidden.docs]) {
    for (const incoming of balance.incomingApprovals) {
      addressMappingIdsToFetch.push({ mappingId: incoming.fromMappingId, collectionId: balance.collectionId });
      addressMappingIdsToFetch.push({ mappingId: incoming.initiatedByMappingId, collectionId: balance.collectionId });
    }

    for (const outgoing of balance.outgoingApprovals) {
      addressMappingIdsToFetch.push({ mappingId: outgoing.toMappingId, collectionId: balance.collectionId });
      addressMappingIdsToFetch.push({ mappingId: outgoing.initiatedByMappingId, collectionId: balance.collectionId });
    }

    for (const incoming of balance.userPermissions.canUpdateIncomingApprovals) {
      addressMappingIdsToFetch.push({ mappingId: incoming.fromMappingId, collectionId: balance.collectionId });
      addressMappingIdsToFetch.push({ mappingId: incoming.initiatedByMappingId, collectionId: balance.collectionId });
    }

    for (const outgoing of balance.userPermissions.canUpdateOutgoingApprovals) {
      addressMappingIdsToFetch.push({ mappingId: outgoing.toMappingId, collectionId: balance.collectionId });
      addressMappingIdsToFetch.push({ mappingId: outgoing.initiatedByMappingId, collectionId: balance.collectionId });
    }
  }

  const addressMappingsToPopulate = await getAddressMappingsFromDB(addressMappingIdsToFetch, true);

  return {
    collected: [
      ...response.docs,
      ...responseWithHidden.docs
    ].map(x => convertBalanceDoc(x, Stringify)).map((collected) => {
      return {
        ...collected,
        incomingApprovals: appendDefaultForIncomingUserApprovals(collected, addressMappingsToPopulate, cosmosAddress),
        outgoingApprovals: appendDefaultForOutgoingUserApprovals(collected, addressMappingsToPopulate, cosmosAddress),
        userPermissions: applyAddressMappingsToUserPermissions(collected.userPermissions, addressMappingsToPopulate),
      };
    }),
    claimAlerts: claimAlertsRes.docs.map(x => convertClaimAlertDoc(x, Stringify)),
    addressMappings: [
      ...addressMappingsRes.docs,
      ...explicitIncludedAddressMappingsRes.docs,
      ...explicitExcludedAddressMappingsRes.docs,
      ...latestAddressMappingsRes.docs,
      ...privateListsRes.docs,
      ...createdListsRes.docs
    ].map(x => addressMappingsToPopulate.find(y => y.mappingId === x.mappingId)).filter(x => x !== undefined).map(x => convertAddressMappingWithMetadata(x!, Stringify)),
    activity: activityRes.docs.map(x => convertTransferActivityDoc(x, Stringify)),
    announcements: announcementsRes.docs.map(x => convertAnnouncementDoc(x, Stringify)),
    reviews: reviewsRes.docs.map(x => convertReviewDoc(x, Stringify)),
    authCodes: authCodesRes.docs.map(x => convertBlockinAuthSignatureDoc(x, Stringify)),
    views: {
      'authCodes': reqBody.viewsToFetch.find(x => x.viewKey === 'authCodes') ? {
        ids: authCodesRes.docs.map(x => x._legacyId),
        type: 'Auth Codes',
        pagination: {
          bookmark: authCodesRes.bookmark ? authCodesRes.bookmark : '',
          // hasMore: authCodesRes.docs.length >= 25
          hasMore: false //we fetch all auth codes if requested
        }
      } : undefined,
      'latestActivity': reqBody.viewsToFetch.find(x => x.viewKey === 'latestActivity') ? {
        ids: activityRes.docs.map(x => x._legacyId),
        type: 'Activity',
        pagination: {
          bookmark: activityRes.bookmark ? activityRes.bookmark : '',
          hasMore: activityRes.docs.length >= 25
        }
      } : undefined,
      'badgesCollected': reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollected') ? {
        ids: response.docs.map(x => x._legacyId),
        type: 'Balances',
        //With the view fetch, we return all balances, so we don't need to check if there are more
        pagination: {
          bookmark: response.bookmark ? response.bookmark : '',
          hasMore: response.docs.length >= 25
        }
      } : undefined,
      'badgesCollectedWithHidden': reqBody.viewsToFetch.find(x => x.viewKey === 'badgesCollectedWithHidden') ? {
        ids: responseWithHidden.docs.map(x => x._legacyId),
        type: 'Balances',
        //With the view fetch, we return all balances, so we don't need to check if there are more
        pagination: {
          bookmark: responseWithHidden.bookmark ? responseWithHidden.bookmark : '',
          hasMore: responseWithHidden.docs.length >= 25
        }
      } : undefined,
      'latestAnnouncements': reqBody.viewsToFetch.find(x => x.viewKey === 'latestAnnouncements') ? {
        ids: announcementsRes.docs.map(x => x._legacyId),
        type: 'Announcements',
        pagination: {
          bookmark: announcementsRes.bookmark ? announcementsRes.bookmark : '',
          hasMore: announcementsRes.docs.length >= 25
        }
      } : undefined,
      'latestReviews': reqBody.viewsToFetch.find(x => x.viewKey === 'latestReviews') ? {
        ids: reviewsRes.docs.map(x => x._legacyId),
        type: 'Reviews',
        pagination: {
          bookmark: reviewsRes.bookmark ? reviewsRes.bookmark : '',
          hasMore: reviewsRes.docs.length >= 25
        }
      } : undefined,
      'addressMappings': reqBody.viewsToFetch.find(x => x.viewKey === 'addressMappings') ? {
        ids: addressMappingsRes.docs.map(x => x._legacyId),
        type: 'Address Mappings',
        pagination: {
          bookmark: addressMappingsRes.bookmark ? addressMappingsRes.bookmark : '',
          hasMore: addressMappingsRes.docs.length >= 25
        }
      } : undefined,
      'latestClaimAlerts': reqBody.viewsToFetch.find(x => x.viewKey === 'latestClaimAlerts') ? {
        ids: claimAlertsRes.docs.map(x => x._legacyId),
        type: 'Claim Alerts',
        pagination: {
          bookmark: claimAlertsRes.bookmark ? claimAlertsRes.bookmark : '',
          hasMore: claimAlertsRes.docs.length >= 25
        }
      } : undefined,
      'privateLists': reqBody.viewsToFetch.find(x => x.viewKey === 'privateLists') ? {
        ids: privateListsRes.docs.map(x => x._legacyId),
        type: 'Private Lists',
        pagination: {
          bookmark: privateListsRes.bookmark ? privateListsRes.bookmark : '',
          hasMore: privateListsRes.docs.length >= 25
        }
      } : undefined,
      'createdLists': reqBody.viewsToFetch.find(x => x.viewKey === 'createdLists') ? {
        ids: createdListsRes.docs.map(x => x._legacyId),
        type: 'Created Lists',
        pagination: {
          bookmark: createdListsRes.bookmark ? createdListsRes.bookmark : '',
          hasMore: createdListsRes.docs.length >= 25
        }
      } : undefined,
      'explicitlyIncludedAddressMappings': reqBody.viewsToFetch.find(x => x.viewKey === 'explicitlyIncludedAddressMappings') ? {
        ids: explicitIncludedAddressMappingsRes.docs.map(x => x._legacyId),
        type: 'Address Mappings',
        pagination: {
          bookmark: explicitIncludedAddressMappingsRes.bookmark ? explicitIncludedAddressMappingsRes.bookmark : '',
          hasMore: explicitIncludedAddressMappingsRes.docs.length >= 25
        }
      } : undefined,
      'explicitlyExcludedAddressMappings': reqBody.viewsToFetch.find(x => x.viewKey === 'explicitlyExcludedAddressMappings') ? {
        ids: explicitExcludedAddressMappingsRes.docs.map(x => x._legacyId),
        type: 'Address Mappings',
        pagination: {
          bookmark: explicitExcludedAddressMappingsRes.bookmark ? explicitExcludedAddressMappingsRes.bookmark : '',
          hasMore: explicitExcludedAddressMappingsRes.docs.length >= 25
        }
      } : undefined,
      'latestAddressMappings': reqBody.viewsToFetch.find(x => x.viewKey === 'latestAddressMappings') ? {
        ids: latestAddressMappingsRes.docs.map(x => x._legacyId),
        type: 'Address Mappings',
        pagination: {
          bookmark: latestAddressMappingsRes.bookmark ? latestAddressMappingsRes.bookmark : '',
          hasMore: latestAddressMappingsRes.docs.length >= 25
        }
      } : undefined,
      'managing': reqBody.viewsToFetch.find(x => x.viewKey === 'managing') ? {
        ids: managingRes.docs,
        type: 'Collections',
        pagination: {
          bookmark: managingRes.bookmark ? managingRes.bookmark : '',
          hasMore: managingRes.docs.length >= 25
        }
      } : undefined,
      'createdBy': reqBody.viewsToFetch.find(x => x.viewKey === 'createdBy') ? {
        ids: createdByRes.docs,
        type: 'Collections',
        pagination: {
          bookmark: createdByRes.bookmark ? createdByRes.bookmark : '',
          hasMore: createdByRes.docs.length >= 25
        }
      } : undefined,
    }
  }
}


export const updateAccountInfo = async (expressReq: Request, res: Response<UpdateAccountInfoRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as UpdateAccountInfoRouteRequestBody<JSPrimitiveNumberType>

    const cosmosAddress = req.session.cosmosAddress;
    let profileInfo = await getFromDB(ProfileModel, cosmosAddress);
    if (!profileInfo) {
      profileInfo = new ProfileModel({
        _legacyId: cosmosAddress,

      });
    }

    if (reqBody.customPages?.find(x => x.title === 'Hidden')) {
      return res.status(400).send({
        message: 'You cannot create a custom page with the title "Hidden".'
      })
    }

    if (reqBody.username) {
      //No . in username allowed
      //Do standard username regex
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(reqBody.username)) {
        return res.status(400).send({
          message: 'Username must be 1 to 15 characters long and can only contain letters, numbers, and underscores.'
        })
      }
    }

    const file = reqBody.profilePicImageFile;
    let profilePicUrl = reqBody.profilePicUrl;
    if (file) {
      const binaryData = Buffer.from(file, 'base64');
      const params = {
        Body: binaryData,
        Bucket: 'bitbadges',
        Key: 'profile-pics/' + cosmosAddress,
        ACL: ObjectCannedACL.public_read,
      };

      await s3.send(new PutObjectCommand(params))
      profilePicUrl = 'https://nyc3.digitaloceanspaces.com/bitbadges/profile-pics/' + cosmosAddress;
    }

    const newProfileInfo: ProfileDoc<JSPrimitiveNumberType> = {
      ...profileInfo,
      discord: reqBody.discord ?? profileInfo.discord,
      twitter: reqBody.twitter ?? profileInfo.twitter,
      github: reqBody.github ?? profileInfo.github,
      telegram: reqBody.telegram ?? profileInfo.telegram,
      seenActivity: reqBody.seenActivity?.toString() ?? profileInfo.seenActivity,
      readme: reqBody.readme ?? profileInfo.readme,
      hiddenBadges: reqBody.hiddenBadges ?? profileInfo.hiddenBadges,
      customPages: reqBody.customPages ?? profileInfo.customPages,
      profilePicUrl: profilePicUrl ?? profileInfo.profilePicUrl,
      username: reqBody.username ?? profileInfo.username,
    };

    const profileSize = JSON.stringify(newProfileInfo).length;
    if (profileSize > 100000) {
      return res.status(400).send({
        message: 'Profile information is too large to store. Please reduce the size of the details for your profile.'
      })
    }
    const session = await MongoDB.startSession();
    session.startTransaction();
    try {
      //Delete any previous usernames
      const previouslyHadUsername = !!profileInfo.username
      if (previouslyHadUsername && profileInfo.username) await deleteMany(UsernameModel, [profileInfo.username], session);

      if (reqBody.username) {
        //fail if already taken (upsert = false)
        try {
          await UsernameModel.create([{ _legacyId: reqBody.username }], { session });
        } catch (e) {
          throw new Error('Username already taken');
        }
      }

      await insertToDB(ProfileModel, newProfileInfo, session);

      await session.commitTransaction();
      await session.endSession();
    } catch (e) {
      await session.abortTransaction();
      await session.endSession();
      throw e;
    }

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