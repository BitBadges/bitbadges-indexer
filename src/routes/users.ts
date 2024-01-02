
import { ObjectCannedACL, PutObjectCommand } from "@aws-sdk/client-s3";
import { BigIntify, JSPrimitiveNumberType, SupportedChain } from "bitbadgesjs-proto";
import { AccountDoc, AccountInfoBase, AddressMappingDoc, AddressMappingWithMetadata, AnnouncementDoc, BalanceDoc, BalanceDocWithDetails, BitBadgesUserInfo, BlockinAuthSignatureDoc, ClaimAlertDoc, GetAccountRouteRequestBody, GetAccountRouteResponse, GetAccountsRouteRequestBody, GetAccountsRouteResponse, ListActivityDoc, MINT_ACCOUNT, NumberType, PaginationInfo, ProfileDoc, ReviewDoc, Stringify, TransferActivityDoc, UpdateAccountInfoRouteRequestBody, UpdateAccountInfoRouteResponse, convertAddressMappingWithMetadata, convertAnnouncementDoc, convertBalanceDoc, convertBitBadgesUserInfo, convertBlockinAuthSignatureDoc, convertClaimAlertDoc, convertListActivityDoc, convertProfileDoc, convertReviewDoc, convertToCosmosAddress, convertTransferActivityDoc, cosmosToBtc, cosmosToEth, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfAuthenticated } from "../blockin/blockin_handlers";
import { CleanedCosmosAccountInformation } from "../chain-client/queries";
import { AccountModel, ProfileModel, UsernameModel, deleteMany, getFromDB, getManyFromDB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { s3 } from "../indexer-vars";
import { applyAddressMappingsToUserPermissions } from './balances';
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { executeListsActivityQuery, executeActivityQuery, executeCollectedQuery, executeManagingQuery, executeCreatedByQuery, executeAnnouncementsQuery, executeReviewsQuery, executeClaimAlertsQuery, executeAuthCodesQuery, executeListsQuery, executeExplicitIncludedListsQuery, executeExplicitExcludedListsQuery, executeLatestAddressMappingsQuery, executePrivateListsQuery, executeCreatedListsQuery } from "./userQueries";

type AccountFetchOptions = GetAccountRouteRequestBody;

async function getBatchAccountInformation(queries: { address: string, fetchOptions?: AccountFetchOptions }[]) {
  const accountInfos: AccountInfoBase<JSPrimitiveNumberType>[] = [];
  const addressesToFetchWithSequence = queries.filter(x => x.fetchOptions?.fetchSequence).map(x => x.address);
  const addressesToFetchWithoutSequence = queries.filter(x => !x.fetchOptions?.fetchSequence).map(x => x.address);

  //Get from blockchain if requested, else get cached vals from DB
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
          btcAddress: cosmosToBtc(convertToCosmosAddress(address)),
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
  const profileInfos: ProfileDoc<JSPrimitiveNumberType>[] = [];
  const addressesToFetch = queries.map(x => convertToCosmosAddress(x.address));

  if (addressesToFetch.length === 0) return addressesToFetch.map(x => ({
    _legacyId: x,
  }));

  const docs = await getManyFromDB(ProfileModel, addressesToFetch);

  for (const address of addressesToFetch) {
    const doc = docs.find(x => x && x._legacyId === address);
    if (doc) {
      profileInfos.push(doc);
    } else {
      profileInfos.push({
        _legacyId: address,
      });
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
      ...convertProfileDoc(profileInfo, BigIntify),
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

    let account: BitBadgesUserInfo<NumberType>;
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
            ...profileInfos[idx],
            _legacyId: convertToCosmosAddress(account.cosmosAddress),
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

interface GetAdditionalUserInfoRes {
  collected: BalanceDocWithDetails<JSPrimitiveNumberType>[],
  activity: TransferActivityDoc<JSPrimitiveNumberType>[],
  listsActivity: ListActivityDoc<JSPrimitiveNumberType>[],
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
}
const getAdditionalUserInfo = async (req: Request, profileInfo: ProfileDoc<bigint>, cosmosAddress: string, reqBody: AccountFetchOptions): Promise<GetAdditionalUserInfoRes> => {
  if (!reqBody.viewsToFetch) return {
    collected: [],
    activity: [],
    listsActivity: [],
    announcements: [],
    reviews: [],
    addressMappings: [],
    claimAlerts: [],
    authCodes: [],
    views: {},
  };

  const authReq = req as AuthenticatedRequest<NumberType>;

  let isAuthenticated = false;
  if (authReq.session && checkIfAuthenticated(authReq)) {
    if (authReq.session.cosmosAddress !== cosmosAddress) {

    } else {
      isAuthenticated = true;
    }
  }


  const asyncOperations = [];
  for (const view of reqBody.viewsToFetch) {
    const bookmark = view.bookmark;
    const filteredCollections = view.filteredCollections;
    const filteredLists = view.filteredLists;
    if (view.viewType === 'listsActivity') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeListsActivityQuery(cosmosAddress, profileInfo, false, bookmark));
      }
    } else if (view.viewType === 'latestActivity') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeActivityQuery(cosmosAddress, profileInfo, false, bookmark));
      }
    } else if (view.viewType === 'badgesCollected' || view.viewType === 'badgesCollectedWithHidden') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeCollectedQuery(cosmosAddress, profileInfo, view.viewType === 'badgesCollectedWithHidden', filteredCollections, bookmark));
      }
    } else if (view.viewType === 'managing') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeManagingQuery(cosmosAddress, profileInfo, filteredCollections, bookmark));
      }
    } else if (view.viewType === 'createdBy') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeCreatedByQuery(cosmosAddress, profileInfo, filteredCollections, bookmark));
      }
    } else if (view.viewType === 'latestAnnouncements') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeAnnouncementsQuery(cosmosAddress, bookmark));
      }
    } else if (view.viewType === 'latestReviews') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeReviewsQuery(cosmosAddress, bookmark));
      }
    } else if (view.viewType === 'latestClaimAlerts') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(() => executeClaimAlertsQuery(cosmosAddress, bookmark));
      }
    } else if (view.viewType === 'authCodes') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(() => executeAuthCodesQuery(cosmosAddress, bookmark));
      }
    } else if (view.viewType === 'addressMappings') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeListsQuery(cosmosAddress, filteredLists, bookmark));
      }
    } else if (view.viewType === 'explicitlyIncludedAddressMappings') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeExplicitIncludedListsQuery(cosmosAddress, filteredLists, bookmark));
      }
    } else if (view.viewType === 'explicitlyExcludedAddressMappings') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeExplicitExcludedListsQuery(cosmosAddress, filteredLists, bookmark));
      }
    } else if (view.viewType === 'latestAddressMappings') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeLatestAddressMappingsQuery(cosmosAddress, filteredLists, bookmark));
      }
    } else if (view.viewType === 'privateLists') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(() => executePrivateListsQuery(cosmosAddress, filteredLists, bookmark));
      }
    } else if (view.viewType === 'createdLists') {
      if (bookmark !== undefined) {
        asyncOperations.push(() => executeCreatedListsQuery(cosmosAddress, filteredLists, bookmark));
      }
    }
  }

  const results = await Promise.all(asyncOperations.map(operation => operation()));
  const addressMappingIdsToFetch: { collectionId?: NumberType; mappingId: string }[] = [];
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;

    if (viewKey === 'listsActivity' || viewKey === 'addressMappings' || viewKey === 'explicitlyIncludedAddressMappings' || viewKey === 'explicitlyExcludedAddressMappings' || viewKey === 'latestAddressMappings' || viewKey === 'privateLists' || viewKey === 'createdLists') {
      const result = results[i] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>> | nano.MangoResponse<ListActivityDoc<JSPrimitiveNumberType>>;
      for (const doc of result.docs) {
        addressMappingIdsToFetch.push({ mappingId: doc.mappingId });
      }
    } else if (viewKey === 'badgesCollected' || viewKey === 'badgesCollectedWithHidden') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
      for (const balance of result.docs) {
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
    }
  }

  const addressMappingsToPopulate = await getAddressMappingsFromDB(addressMappingIdsToFetch, true);
  const views: { [viewId: string]: { ids: string[], type: string, pagination: PaginationInfo } | undefined } = {};
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;
    const viewId = reqBody.viewsToFetch[i].viewId;

    if (viewKey === 'listsActivity') {
      const result = results[i] as nano.MangoResponse<ListActivityDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'ListActivity',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'addressMappings' || viewKey === 'explicitlyIncludedAddressMappings' || viewKey === 'explicitlyExcludedAddressMappings' || viewKey === 'latestAddressMappings' || viewKey === 'privateLists' || viewKey === 'createdLists') {
      const result = results[i] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Address Mappings',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'badgesCollected' || viewKey === 'badgesCollectedWithHidden') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Balances',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'authCodes') {
      const result = results[i] as nano.MangoResponse<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Auth Codes',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: false, //we fetch all auth codes if requested
        }
      }
    } else if (viewKey === 'latestClaimAlerts') {
      const result = results[i] as nano.MangoResponse<ClaimAlertDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Claim Alerts',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'latestActivity') {
      const result = results[i] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Activity',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'latestAnnouncements') {
      const result = results[i] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Announcements',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'latestReviews') {
      const result = results[i] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
      views[viewId] = {
        ids: result.docs.map(x => x._legacyId),
        type: 'Reviews',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'managing') {

      const result = results[i] as any
      views[viewId] = {
        ids: result.docs,
        type: 'Collections',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    } else if (viewKey === 'createdBy') {
      const result = results[i] as any
      views[viewId] = {
        ids: result.docs,
        type: 'Collections',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      }
    }
  }


  const responseObj: GetAdditionalUserInfoRes = {
    collected: [],
    activity: [],
    listsActivity: [],
    announcements: [],
    reviews: [],
    addressMappings: [],
    claimAlerts: [],
    authCodes: [],
    views: {},
  };
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;
    if (viewKey === 'listsActivity') {
      const result = results[i] as nano.MangoResponse<ListActivityDoc<JSPrimitiveNumberType>>;
      responseObj.listsActivity = result.docs.map(x => convertListActivityDoc(x, Stringify));
    } else if (viewKey === 'badgesCollected' || viewKey === 'badgesCollectedWithHidden') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
      responseObj.collected = [
        ...responseObj.collected,
        ...result.docs
      ].map(x => convertBalanceDoc(x, Stringify)).map((collected) => {
        return {
          ...collected,
          incomingApprovals: appendDefaultForIncomingUserApprovals(collected, addressMappingsToPopulate, cosmosAddress),
          outgoingApprovals: appendDefaultForOutgoingUserApprovals(collected, addressMappingsToPopulate, cosmosAddress),
          userPermissions: applyAddressMappingsToUserPermissions(collected.userPermissions, addressMappingsToPopulate),
        };
      });
    } else if (viewKey === 'latestActivity') {
      const result = results[i] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
      responseObj.activity = result.docs.map(x => convertTransferActivityDoc(x, Stringify));
    } else if (viewKey === 'latestAnnouncements') {
      const result = results[i] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
      responseObj.announcements = result.docs.map(x => convertAnnouncementDoc(x, Stringify));
    } else if (viewKey === 'latestReviews') {
      const result = results[i] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
      responseObj.reviews = result.docs.map(x => convertReviewDoc(x, Stringify));
    } else if (viewKey === 'addressMappings' || viewKey === 'explicitlyIncludedAddressMappings' || viewKey === 'explicitlyExcludedAddressMappings' || viewKey === 'latestAddressMappings' || viewKey === 'privateLists' || viewKey === 'createdLists') {
      const result = results[i] as nano.MangoResponse<AddressMappingDoc<JSPrimitiveNumberType>>;
      responseObj.addressMappings = [
        ...responseObj.addressMappings,
        ...result.docs
      ].map(x => addressMappingsToPopulate.find(y => y.mappingId === x.mappingId)).filter(x => x !== undefined).map(x => convertAddressMappingWithMetadata(x!, Stringify));
    } else if (viewKey === 'latestClaimAlerts') {
      const result = results[i] as nano.MangoResponse<ClaimAlertDoc<JSPrimitiveNumberType>>;
      responseObj.claimAlerts = result.docs.map(x => convertClaimAlertDoc(x, Stringify));
    } else if (viewKey === 'authCodes') {
      const result = results[i] as nano.MangoResponse<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>;
      responseObj.authCodes = result.docs.map(x => convertBlockinAuthSignatureDoc(x, Stringify));
    } else if (viewKey === 'managing') {

    } else if (viewKey === 'createdBy') {

    }
  }

  responseObj.views = views;

  return responseObj;
}


export const updateAccountInfo = async (expressReq: Request, res: Response<UpdateAccountInfoRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as UpdateAccountInfoRouteRequestBody<JSPrimitiveNumberType>

    const cosmosAddress = req.session.cosmosAddress;
    let profileInfo = await getFromDB(ProfileModel, cosmosAddress);
    if (!profileInfo) {
      profileInfo = {
        _legacyId: cosmosAddress,
      };
    }

    if ([
      ...reqBody.customPages ?? [],
      ...reqBody.customListPages ?? [],
      ...reqBody.watchedBadgePages ?? [],
      ...reqBody.watchedListPages ?? [],
    ]?.find(x => !x.title || x.title === 'Hidden' || x.title === 'All' || x.title === 'Created' || x.title === 'Managing' || x.title === 'Included' || x.title === 'Excluded' || x.title === 'Private')) {
      return res.status(400).send({
        message: 'Page name cannot be empty and cannot be a reserved word. Certain page names are reserved by us for special purposes. Please choose a different name.'
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
      hiddenLists: reqBody.hiddenLists ?? profileInfo.hiddenLists,
      customListPages: reqBody.customListPages ?? profileInfo.customListPages,
      watchedBadgePages: reqBody.watchedBadgePages ?? profileInfo.watchedBadgePages,
      watchedListPages: reqBody.watchedListPages ?? profileInfo.watchedListPages,
      profilePicUrl: profilePicUrl ?? profileInfo.profilePicUrl,
      username: reqBody.username ?? profileInfo.username,
    };

    const profileSize = JSON.stringify(newProfileInfo).length;
    if (profileSize > 100000) {
      return res.status(400).send({
        message: 'Profile information is too large to store. Please reduce the size of the details for your profile.'
      })
    }


    //Delete any previous usernames

    //We could probably have a more bulletproof way of doing this, but this is fine for now
    //Didn't want to introduce sessions into this
    //1. Check if new username exists. If not, claim it
    //2. Delete any previous usernames
    if (reqBody.username) {
      //fail if already taken (upsert = false)
      try {
        await UsernameModel.create([{ _legacyId: reqBody.username }]);
        const previouslyHadUsername = !!profileInfo.username
        if (previouslyHadUsername && profileInfo.username) await deleteMany(UsernameModel, [profileInfo.username]);
      } catch (e) {
        throw new Error('Username already taken');
      }
    }

    await insertToDB(ProfileModel, newProfileInfo);

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