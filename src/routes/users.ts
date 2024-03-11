import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import sgMail from '@sendgrid/mail';
import {
  AccountDoc,
  BalanceDocWithDetails,
  BigIntify,
  BitBadgesAddressList,
  BitBadgesUserInfo,
  EmailVerificationStatus,
  NotificationPreferences,
  ProfileDoc,
  SupportedChain,
  convertToBtcAddress,
  convertToCosmosAddress,
  convertToEthAddress,
  getChainForAddress,
  type AccountFetchDetails,
  type AddressListDoc,
  type BalanceDoc,
  type BlockinAuthSignatureDoc,
  type ClaimAlertDoc,
  type ErrorResponse,
  type GetAccountsRouteRequestBody,
  type ListActivityDoc,
  type NumberType,
  type PaginationInfo,
  type ReviewDoc,
  type TransferActivityDoc,
  type UpdateAccountInfoRouteRequestBody,
  type iAccountDoc,
  type iGetAccountsRouteSuccessResponse,
  type iProfileDoc,
  type iUpdateAccountInfoRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import type nano from 'nano';
import { serializeError } from 'serialize-error';
import { findInDB } from '../db/queries';
import { checkIfAuthenticated, type AuthenticatedRequest, type MaybeAuthenticatedRequest } from '../blockin/blockin_handlers';
import { type CleanedCosmosAccountInformation } from '../chain-client/queries';
import { deleteMany, getFromDB, getManyFromDB, insertToDB } from '../db/db';
import { AccountModel, ProfileModel, UsernameModel } from '../db/schemas';
import { client } from '../indexer';
import { s3 } from '../indexer-vars';
import { connectToRpc } from '../poll';
import { applyAddressListsToUserPermissions } from './balances';
import { convertToBitBadgesUserInfo } from './userHelpers';
import {
  executeActivityQuery,
  executeAuthCodesQuery,
  executeClaimAlertsQuery,
  executeCollectedQuery,
  executeCreatedByQuery,
  executeCreatedListsQuery,
  executeExplicitExcludedListsQuery,
  executeExplicitIncludedListsQuery,
  executeListsActivityQuery,
  executeListsQuery,
  executeManagingQuery,
  executePrivateListsQuery,
  executeReviewsQuery
} from './userQueries';
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from './utils';

type AccountFetchOptions = AccountFetchDetails;

async function getBatchAccountInformation(queries: Array<{ address: string; fetchOptions?: AccountFetchOptions }>) {
  const accountInfos: Array<iAccountDoc<bigint> & { chain: SupportedChain }> = [];
  const addressesToFetchWithSequence = queries.filter((x) => x.fetchOptions?.fetchSequence).map((x) => x.address);
  const addressesToFetchWithoutSequence = queries.filter((x) => !x.fetchOptions?.fetchSequence).map((x) => x.address);

  if (!client) {
    await connectToRpc();
  }

  // Get from blockchain if requested, else get cached vals from DB
  const promises = [];
  for (const address of addressesToFetchWithSequence) {
    promises.push(client.badgesQueryClient?.badges.getAccountInfo(address));
  }
  if (addressesToFetchWithoutSequence.length > 0)
    promises.push(
      getManyFromDB(
        AccountModel,
        addressesToFetchWithoutSequence.map((x) => convertToCosmosAddress(x))
      )
    );

  const results = await Promise.all(promises);

  for (let i = 0; i < addressesToFetchWithSequence.length; i++) {
    const result = results[i] as CleanedCosmosAccountInformation;
    accountInfos.push({
      chain: result.chain,
      ...new AccountDoc<NumberType>({
        ...result,
        _docId: result.cosmosAddress,
        solAddress: getChainForAddress(addressesToFetchWithSequence[i]) === SupportedChain.SOLANA ? addressesToFetchWithSequence[i] : ''
      }).convert(BigIntify)
    });
  }

  if (addressesToFetchWithoutSequence.length > 0) {
    const docs = results[addressesToFetchWithSequence.length] as Array<AccountDoc<bigint> | undefined>;
    for (const address of addressesToFetchWithoutSequence) {
      const doc = docs.find((x) => x && x._docId === convertToCosmosAddress(address));
      if (doc) {
        accountInfos.push({
          ...doc,
          solAddress: getChainForAddress(address) === SupportedChain.SOLANA ? address : '',
          chain: getChainForAddress(address)
        });
      } else {
        accountInfos.push({
          _docId: convertToCosmosAddress(address),
          cosmosAddress: convertToCosmosAddress(address),
          btcAddress: convertToBtcAddress(convertToCosmosAddress(address)),
          solAddress: getChainForAddress(address) === SupportedChain.SOLANA ? address : '',
          ethAddress: convertToEthAddress(convertToCosmosAddress(address)),
          chain: getChainForAddress(address),
          sequence: -1n,
          accountNumber: -1n,
          pubKeyType: '',
          publicKey: ''
        });
      }
    }
  }

  return accountInfos;
}

async function getBatchProfileInformation(req: Request | undefined, queries: Array<{ address: string; fetchOptions?: AccountFetchOptions }>) {
  const profileInfos: Array<ProfileDoc<bigint>> = [];
  const addressesToFetch = queries.map((x) => convertToCosmosAddress(x.address));

  if (addressesToFetch.length === 0) {
    return addressesToFetch.map((x) => new ProfileDoc<bigint>({ _docId: x }));
  }

  const docs = await getManyFromDB(ProfileModel, addressesToFetch);

  for (const address of addressesToFetch) {
    const doc = docs.find((x) => x && x._docId === address);
    if (doc) {
      profileInfos.push(doc);
    } else {
      profileInfos.push(
        new ProfileDoc<bigint>({
          _docId: address
        })
      );
    }
  }

  // Filter out private info if not authenticated user

  if (req && req.session) {
    const currAddress = (req.session as any).cosmosAddress;
    for (const profileInfo of profileInfos) {
      if (profileInfo._docId !== currAddress) {
        profileInfo.notifications = undefined;
        profileInfo.approvedSignInMethods = undefined;
      }
    }
  }

  return profileInfos;
}

export const getAccountByAddress = async (req: Request | undefined, address: string, fetchOptions?: AccountFetchOptions) => {
  if (address === 'Mint') return BitBadgesUserInfo.MintAccount();
  const accountInfo = (await getBatchAccountInformation([{ address, fetchOptions }]))[0];
  const profileInfo = (await getBatchProfileInformation(req, [{ address, fetchOptions }]))[0];

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileInfo }], [{ ...accountInfo }], fetchName); // Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];
  if (fetchOptions) {
    // account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(
      req,
      {
        ...profileInfo,
        _docId: convertToCosmosAddress(address)
      },
      account.cosmosAddress,
      fetchOptions
    );
    account = new BitBadgesUserInfo({
      ...account,
      ...portfolioRes
    });
  }

  return account;
};

const resolveUsernames = async (usernames: string[]) => {
  const promises = [];
  for (const username of usernames) {
    promises.push(findInDB(ProfileModel, { query: { username }, limit: 1 }));
  }

  const results = await Promise.all(promises);
  const docs = results.map((x) => x[0]);
  return docs;
};

export const getAccountByUsername = async (req: Request, username: string, fetchOptions?: AccountFetchOptions) => {
  const profilesRes = await resolveUsernames([username]);
  const profileDoc = profilesRes[0];

  const accountInfo = (await getBatchAccountInformation([{ address: profileDoc._docId, fetchOptions }]))[0];

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo([{ ...profileDoc }], [{ ...accountInfo }], fetchName); // Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];

  if (fetchOptions) {
    // account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(req, profileDoc, account.cosmosAddress, fetchOptions);
    account = new BitBadgesUserInfo({
      ...account,
      ...portfolioRes
    });
  }

  return account;
};

// Get by address, cosmosAddress, accountNumber, or username
// ENS names are not supported. Convert to address first
export const getAccounts = async (req: Request, res: Response<iGetAccountsRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetAccountsRouteRequestBody;
    const allDoNotHaveExternalCalls = reqBody.accountsToFetch.every((x) => x.noExternalCalls);
    if (!allDoNotHaveExternalCalls && reqBody.accountsToFetch.length > 250) {
      return res.status(400).send({
        errorMessage: 'You can only fetch up to 250 accounts with external calls at a time. Please structure your request accordingly.'
      });
    } else if (allDoNotHaveExternalCalls && reqBody.accountsToFetch.length > 10000) {
      return res.status(400).send({
        errorMessage: 'You can only fetch up to 10,000 accounts without external calls at a time. Please structure your request accordingly.'
      });
    }

    const usernames = reqBody.accountsToFetch
      .filter((x) => x.username)
      .map((x) => x.username)
      .filter((x) => x !== undefined) as string[];

    const profileDocs = await resolveUsernames(usernames);
    const allQueries = profileDocs.map((x) => {
      return {
        address: x._docId,
        fetchOptions: reqBody.accountsToFetch.find((y) => y.username === x.username)
      };
    });

    for (const accountFetchOptions of reqBody.accountsToFetch) {
      if (accountFetchOptions.address) {
        allQueries.push({
          address: accountFetchOptions.address,
          fetchOptions: accountFetchOptions
        });
      }
    }
    const accountInfos = await getBatchAccountInformation(allQueries);
    const profileInfos = await getBatchProfileInformation(req, allQueries);

    const userInfos = await convertToBitBadgesUserInfo(profileInfos, accountInfos, !allDoNotHaveExternalCalls);

    const additionalInfoPromises = [];
    for (const query of allQueries) {
      if (query.fetchOptions) {
        const idx = userInfos.findIndex((x) =>
          query.address ? x.cosmosAddress === convertToCosmosAddress(query.address) : x.username === query.fetchOptions?.username
        );
        if (idx === -1) {
          throw new Error('Could not find account');
        }
        const account = userInfos[idx];

        additionalInfoPromises.push(
          getAdditionalUserInfo(
            req,
            {
              ...profileInfos[idx]
            },
            account.cosmosAddress,
            query.fetchOptions
          )
        );
      }
    }

    const additionalInfos = await Promise.all(additionalInfoPromises);
    for (const query of allQueries) {
      if (query.fetchOptions) {
        const idx = userInfos.findIndex((x) =>
          query.address ? x.cosmosAddress === convertToCosmosAddress(query.address) : x.username === query.fetchOptions?.username
        );
        if (idx === -1) {
          throw new Error('Could not find account');
        }
        const account = userInfos[idx];

        userInfos[idx] = new BitBadgesUserInfo({
          ...account,
          ...additionalInfos[idx]
        });
      }
    }

    return res.status(200).send({ accounts: userInfos });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching accounts. Please try again later.'
    });
  }
};

interface GetAdditionalUserInfoRes {
  collected: Array<BalanceDocWithDetails<bigint>>;
  activity: Array<TransferActivityDoc<bigint>>;
  listsActivity: Array<ListActivityDoc<bigint>>;
  reviews: Array<ReviewDoc<bigint>>;
  addressLists: Array<BitBadgesAddressList<bigint>>;
  claimAlerts: Array<ClaimAlertDoc<bigint>>;
  authCodes: Array<BlockinAuthSignatureDoc<bigint>>;
  views: Record<
    string,
    | {
        ids: string[];
        type: string;
        pagination: PaginationInfo;
      }
    | undefined
  >;
}

const getAdditionalUserInfo = async (
  req: Request | undefined,
  profileInfo: iProfileDoc<bigint>,
  cosmosAddress: string,
  reqBody: AccountFetchOptions
): Promise<GetAdditionalUserInfoRes> => {
  if (!reqBody.viewsToFetch) {
    return {
      collected: [],
      activity: [],
      listsActivity: [],
      reviews: [],
      addressLists: [],
      claimAlerts: [],
      authCodes: [],
      views: {}
    };
  }

  const authReq = req as MaybeAuthenticatedRequest<NumberType>;
  const isAuthenticated = checkIfAuthenticated(authReq) && authReq.session && authReq.session.cosmosAddress === cosmosAddress;

  const asyncOperations = [];
  for (const view of reqBody.viewsToFetch) {
    const bookmark = view.bookmark;
    const filteredCollections = view.specificCollections;
    const filteredLists = view.specificLists;
    const oldestFirst = view.oldestFirst;
    if (view.viewType === 'listsActivity') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeListsActivityQuery(cosmosAddress, profileInfo, false, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'transferActivity') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeActivityQuery(cosmosAddress, profileInfo, false, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'badgesCollected') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeCollectedQuery(cosmosAddress, profileInfo, false, filteredCollections, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'managingBadges') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeManagingQuery(cosmosAddress, profileInfo, filteredCollections, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'createdBadges') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeCreatedByQuery(cosmosAddress, profileInfo, filteredCollections, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'reviews') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeReviewsQuery(cosmosAddress, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'claimAlerts') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(async () => await executeClaimAlertsQuery(cosmosAddress, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'authCodes') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(async () => await executeAuthCodesQuery(cosmosAddress, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'allLists') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'whitelists') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeExplicitIncludedListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'blacklists') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeExplicitExcludedListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'privateLists') {
      if (bookmark !== undefined) {
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(async () => await executePrivateListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'createdLists') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeCreatedListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    }
  }

  const results = await Promise.all(asyncOperations.map(async (operation) => await operation()));
  const addressListIdsToFetch: Array<{ collectionId?: NumberType; listId: string }> = [];
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;

    if (
      viewKey === 'listsActivity' ||
      viewKey === 'allLists' ||
      viewKey === 'whitelists' ||
      viewKey === 'blacklists' ||
      viewKey === 'privateLists' ||
      viewKey === 'createdLists'
    ) {
      const result = results[i] as nano.MangoResponse<AddressListDoc<bigint>> | nano.MangoResponse<ListActivityDoc<bigint>>;

      for (const doc of result.docs) {
        addressListIdsToFetch.push({ listId: doc.listId });
      }
    } else if (viewKey === 'badgesCollected') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<bigint>>;
      for (const balance of result.docs) {
        for (const incoming of balance.incomingApprovals) {
          addressListIdsToFetch.push({
            listId: incoming.fromListId,
            collectionId: balance.collectionId
          });
          addressListIdsToFetch.push({
            listId: incoming.initiatedByListId,
            collectionId: balance.collectionId
          });
        }

        for (const outgoing of balance.outgoingApprovals) {
          addressListIdsToFetch.push({
            listId: outgoing.toListId,
            collectionId: balance.collectionId
          });
          addressListIdsToFetch.push({
            listId: outgoing.initiatedByListId,
            collectionId: balance.collectionId
          });
        }

        for (const incoming of balance.userPermissions.canUpdateIncomingApprovals) {
          addressListIdsToFetch.push({
            listId: incoming.fromListId,
            collectionId: balance.collectionId
          });
          addressListIdsToFetch.push({
            listId: incoming.initiatedByListId,
            collectionId: balance.collectionId
          });
        }

        for (const outgoing of balance.userPermissions.canUpdateOutgoingApprovals) {
          addressListIdsToFetch.push({
            listId: outgoing.toListId,
            collectionId: balance.collectionId
          });
          addressListIdsToFetch.push({
            listId: outgoing.initiatedByListId,
            collectionId: balance.collectionId
          });
        }
      }
    }
  }

  const addressListsToPopulate = await getAddressListsFromDB(addressListIdsToFetch, true);
  const views: Record<string, { ids: string[]; type: string; pagination: PaginationInfo } | undefined> = {};
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;
    const viewId = reqBody.viewsToFetch[i].viewId;

    if (viewKey === 'listsActivity') {
      const result = results[i] as nano.MangoResponse<ListActivityDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'ListActivity',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (
      viewKey === 'allLists' ||
      viewKey === 'whitelists' ||
      viewKey === 'blacklists' ||
      viewKey === 'privateLists' ||
      viewKey === 'createdLists'
    ) {
      const result = results[i] as nano.MangoResponse<AddressListDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Address Lists',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'badgesCollected') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Balances',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'authCodes') {
      const result = results[i] as nano.MangoResponse<BlockinAuthSignatureDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Auth Codes',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: false // we fetch all auth codes if requested
        }
      };
    } else if (viewKey === 'claimAlerts') {
      const result = results[i] as nano.MangoResponse<ClaimAlertDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Claim Alerts',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'transferActivity') {
      const result = results[i] as nano.MangoResponse<TransferActivityDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Activity',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'reviews') {
      const result = results[i] as nano.MangoResponse<ReviewDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Reviews',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'managingBadges') {
      const result = results[i] as any;
      views[viewId] = {
        ids: result.docs,
        type: 'Collections',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'createdBadges') {
      const result = results[i] as any;
      views[viewId] = {
        ids: result.docs,
        type: 'Collections',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    }
  }

  const responseObj: GetAdditionalUserInfoRes = {
    collected: [],
    activity: [],
    listsActivity: [],
    reviews: [],
    addressLists: [],
    claimAlerts: [],
    authCodes: [],
    views: {}
  };
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqBody.viewsToFetch[i].viewType;
    if (viewKey === 'listsActivity') {
      const result = results[i] as nano.MangoResponse<ListActivityDoc<bigint>>;
      responseObj.listsActivity = result.docs;
    } else if (viewKey === 'badgesCollected') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<bigint>>;
      responseObj.collected = [...responseObj.collected, ...result.docs].map((collected) => {
        const newIncomingApprovals = appendSelfInitiatedIncomingApprovalToApprovals(collected, addressListsToPopulate, cosmosAddress);
        const newOutgoingApprovals = appendSelfInitiatedOutgoingApprovalToApprovals(collected, addressListsToPopulate, cosmosAddress);
        const newUserPermissions = applyAddressListsToUserPermissions(collected.userPermissions, addressListsToPopulate);

        return new BalanceDocWithDetails<bigint>({
          ...collected,
          incomingApprovals: newIncomingApprovals,
          outgoingApprovals: newOutgoingApprovals,
          userPermissions: newUserPermissions
        });
      });
    } else if (viewKey === 'transferActivity') {
      const result = results[i] as nano.MangoResponse<TransferActivityDoc<bigint>>;
      responseObj.activity = result.docs;
    } else if (viewKey === 'reviews') {
      const result = results[i] as nano.MangoResponse<ReviewDoc<bigint>>;
      responseObj.reviews = result.docs;
    } else if (
      viewKey === 'allLists' ||
      viewKey === 'whitelists' ||
      viewKey === 'blacklists' ||
      viewKey === 'privateLists' ||
      viewKey === 'createdLists'
    ) {
      const result = results[i] as nano.MangoResponse<AddressListDoc<bigint>>;
      responseObj.addressLists = [...responseObj.addressLists, ...result.docs]
        .map((x) => addressListsToPopulate.find((y) => y.listId === x.listId)!)
        .map((x) => new BitBadgesAddressList<bigint>(x));
    } else if (viewKey === 'claimAlerts') {
      const result = results[i] as nano.MangoResponse<ClaimAlertDoc<bigint>>;
      responseObj.claimAlerts = result.docs;
    } else if (viewKey === 'authCodes') {
      const result = results[i] as nano.MangoResponse<BlockinAuthSignatureDoc<bigint>>;
      responseObj.authCodes = result.docs;
    }
    // nothing to do with managing or createdBy
  }

  responseObj.views = views;

  return responseObj;
};

export const updateAccountInfo = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateAccountInfoRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as UpdateAccountInfoRouteRequestBody;

    const cosmosAddress = req.session.cosmosAddress;
    let profileInfo = await getFromDB(ProfileModel, cosmosAddress);
    if (!profileInfo) {
      profileInfo = new ProfileDoc({
        _docId: cosmosAddress
      });
    }

    if (
      [
        ...(reqBody.customPages?.badges ?? []),
        ...(reqBody.customPages?.lists ?? []),
        ...(reqBody.watchlists?.badges ?? []),
        ...(reqBody.watchlists?.lists ?? [])
      ]?.find(
        (x) =>
          !x.title ||
          x.title === 'Hidden' ||
          x.title === 'All' ||
          x.title === 'Created' ||
          x.title === 'Managing' ||
          x.title === 'Included' ||
          x.title === 'Excluded' ||
          x.title === 'Private'
      )
    ) {
      return res.status(400).send({
        errorMessage:
          'Page name cannot be empty and cannot be a reserved word. Certain page names are reserved by us for special purposes. Please choose a different name.'
      });
    }

    if (reqBody.username) {
      // No . in username allowed
      // Do standard username regex
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(reqBody.username)) {
        return res.status(400).send({
          errorMessage: 'Username must be 1 to 15 characters long and can only contain letters, numbers, and underscores.'
        });
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
        ACL: ObjectCannedACL.public_read
      };

      await s3.send(new PutObjectCommand(params));
      profilePicUrl = 'https://nyc3.digitaloceanspaces.com/bitbadges/profile-pics/' + cosmosAddress;
    }

    const newProfileInfo = new ProfileDoc({
      ...profileInfo,
      discord: reqBody.discord ?? profileInfo.discord,
      twitter: reqBody.twitter ?? profileInfo.twitter,
      github: reqBody.github ?? profileInfo.github,
      telegram: reqBody.telegram ?? profileInfo.telegram,
      seenActivity: reqBody.seenActivity?.toString() ?? profileInfo.seenActivity,
      readme: reqBody.readme ?? profileInfo.readme,
      hiddenBadges: reqBody.hiddenBadges ?? profileInfo.hiddenBadges,
      customPages: reqBody.customPages ?? profileInfo.customPages,
      watchlists: reqBody.watchlists ?? profileInfo.watchlists,
      hiddenLists: reqBody.hiddenLists ?? profileInfo.hiddenLists,
      profilePicUrl: profilePicUrl ?? profileInfo.profilePicUrl,
      username: reqBody.username ?? profileInfo.username,
      approvedSignInMethods: reqBody.approvedSignInMethods ?? profileInfo.approvedSignInMethods
    });

    const profileSize = JSON.stringify(newProfileInfo).length;
    if (profileSize > 100000) {
      return res.status(400).send({
        errorMessage: 'Profile information is too large to store. Please reduce the size of the details for your profile.'
      });
    }

    if (reqBody.notifications) {
      if (reqBody.notifications.email && reqBody.notifications.email !== profileInfo.notifications?.email) {
        const uniqueToken = crypto.randomBytes(32).toString('hex');
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});

        newProfileInfo.notifications.email = reqBody.notifications.email;

        // Is valid email - regex
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reqBody.notifications.email)) {
          return res.status(400).send({
            errorMessage: 'Email is not valid.'
          });
        }

        newProfileInfo.notifications.emailVerification = new EmailVerificationStatus({
          ...newProfileInfo.notifications.emailVerification,
          verified: false,
          token: uniqueToken,
          expiry: Number(Date.now() + 1000 * 60 * 60 * 1) // 1 hour
        });
        newProfileInfo.notifications.preferences = reqBody.notifications.preferences;

        const emails: Array<{
          to: string;
          from: string;
          subject: string;
          text: string;
        }> = [
          {
            to: reqBody.notifications.email,
            from: 'mail@em2620.bitbadges.io',
            subject: 'Verify your email',
            text: `Please verify your email by clicking on this link: https://bitbadges.io/email-verify/${uniqueToken}`
          }
        ];
        sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
        await sgMail.send(emails, true);
      } else if (reqBody.notifications.email !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.email = reqBody.notifications.email;
      }

      if (reqBody.notifications.antiPhishingCode !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.emailVerification = newProfileInfo.notifications.emailVerification ?? new EmailVerificationStatus({});
        newProfileInfo.notifications.emailVerification.antiPhishingCode = reqBody.notifications.antiPhishingCode;
      }

      if (reqBody.notifications.preferences !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.preferences = reqBody.notifications.preferences;
      }
    }

    // Delete any previous usernames

    // We could probably have a more bulletproof way of doing this, but this is fine for now
    // Didn't want to introduce sessions into this
    // 1. Check if new username exists. If not, claim it
    // 2. Delete any previous usernames
    if (reqBody.username && reqBody.username !== profileInfo.username) {
      // fail if already taken (upsert = false)
      try {
        await UsernameModel.create([{ _docId: reqBody.username }]);
        const previouslyHadUsername = !!profileInfo.username;
        if (previouslyHadUsername && profileInfo.username) await deleteMany(UsernameModel, [profileInfo.username]);
      } catch (e) {
        throw new Error('Username already taken');
      }
    }

    await insertToDB(ProfileModel, newProfileInfo);

    return res.status(200).send({ errorMessage: 'Account info updated successfully' });
  } catch (e) {
    console.log('Error updating account info', e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error updating account info. Please try again later.'
    });
  }
};
