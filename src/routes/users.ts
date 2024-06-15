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
  iApprovalInfoDetails,
  iChallengeDetails,
  type AccountFetchDetails,
  type AddressListDoc,
  type AttestationDoc,
  type BalanceDoc,
  type ClaimAlertDoc,
  type ErrorResponse,
  type GetAccountsPayload,
  type ListActivityDoc,
  type NumberType,
  type PaginationInfo,
  type ReviewDoc,
  type SIWBBRequestDoc,
  type TransferActivityDoc,
  type UpdateAccountInfoPayload,
  type iAccountDoc,
  type iGetAccountsSuccessResponse,
  type iProfileDoc,
  type iUpdateAccountInfoSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import type nano from 'nano';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import {
  checkIfAuthenticated,
  getAuthDetails,
  mustGetAuthDetails,
  setMockSessionIfTestMode,
  type AuthenticatedRequest,
  type MaybeAuthenticatedRequest
} from '../blockin/blockin_handlers';
import { type CleanedCosmosAccountInformation } from '../chain-client/queries';
import { deleteMany, getFromDB, getManyFromDB, insertMany, insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AccountModel, FetchModel, ProfileModel, UsernameModel } from '../db/schemas';
import { client, s3 } from '../indexer-vars';
import { addChallengeDetailsToCriteria } from './badges';
import { applyAddressListsToUserPermissions } from './balances';
import { typiaError } from './search';
import { convertToBitBadgesUserInfo } from './userHelpers';
import {
  executeActivityQuery,
  executeClaimAlertsQuery,
  executeCollectedQuery,
  executeCreatedAttestationsQuery,
  executeCreatedByQuery,
  executeCreatedListsQuery,
  executeExplicitExcludedListsQuery,
  executeExplicitIncludedListsQuery,
  executeListsActivityQuery,
  executeListsQuery,
  executeManagingQuery,
  executePrivateListsQuery,
  executeReceivedAttestationsQuery,
  executeReviewsQuery,
  executeSIWBBRequestsQuery,
  executeSentClaimAlertsQuery
} from './userQueries';
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from './utils';

type AccountFetchOptions = AccountFetchDetails;

async function getBatchAccountInformation(queries: Array<{ address: string; fetchOptions?: AccountFetchOptions }>) {
  const accountInfos: Array<iAccountDoc<bigint> & { chain: SupportedChain }> = [];
  const addressesToFetchWithSequence = queries.filter((x) => x.fetchOptions?.fetchSequence).map((x) => x.address);
  const addressesToFetchWithoutSequence = queries.filter((x) => !x.fetchOptions?.fetchSequence).map((x) => x.address);

  // Get from blockchain if requested, else get cached vals from DB
  const promises = [];
  for (const address of addressesToFetchWithSequence) {
    promises.push(client?.badgesQueryClient?.badges.getAccountInfo(address));
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

async function getBatchProfileInformation(
  req: Request | undefined,
  res: Response,
  queries: Array<{ address: string; fetchOptions?: AccountFetchOptions }>
) {
  const profileInfos: Array<ProfileDoc<bigint>> = [];
  const addressesToFetch = queries.map((x) => convertToCosmosAddress(x.address));
  const nativeAddresses = queries.map((x) => x.address);

  if (addressesToFetch.length === 0) {
    return addressesToFetch.map((x) => new ProfileDoc<bigint>({ _docId: x }));
  }

  const docs = await getManyFromDB(ProfileModel, addressesToFetch);
  const solanaDocsToAdd = [];
  for (let i = 0; i < addressesToFetch.length; i++) {
    const address = addressesToFetch[i];
    const nativeAddress = nativeAddresses[i];
    const doc = docs.find((x) => x && x._docId === address);
    if (doc) {
      profileInfos.push(doc);
    } else {
      const isSolAddress = getChainForAddress(nativeAddress) === SupportedChain.SOLANA;
      if (isSolAddress) {
        solanaDocsToAdd.push(
          new ProfileDoc<bigint>({
            _docId: address,
            solAddress: nativeAddress
          })
        );
      }

      profileInfos.push(
        new ProfileDoc<bigint>({
          _docId: address,
          solAddress: isSolAddress ? nativeAddress : undefined
        })
      );
    }
  }

  if (solanaDocsToAdd.length) await insertMany(ProfileModel, solanaDocsToAdd);

  return profileInfos;
}

export const getAccountByAddress = async (req: Request | undefined, res: Response, address: string, fetchOptions?: AccountFetchOptions) => {
  if (address === 'Mint') return BitBadgesUserInfo.MintAccount();
  const accountInfo = (await getBatchAccountInformation([{ address, fetchOptions }]))[0];
  const profileInfo = (await getBatchProfileInformation(req, res, [{ address, fetchOptions }]))[0];

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo(req, res, [{ ...profileInfo }], [{ ...accountInfo }], fetchName); // Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];
  if (fetchOptions) {
    // account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(
      req,
      res,
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
    promises.push(
      findInDB(ProfileModel, {
        query: {
          username: {
            $eq: username
          }
        },
        limit: 1
      })
    );
  }

  const results = await Promise.all(promises);
  const docs = results.map((x) => x[0]);
  return docs;
};

export const getAccountByUsername = async (req: Request, res: Response, username: string, fetchOptions?: AccountFetchOptions) => {
  const profilesRes = await resolveUsernames([username]);
  const profileDoc = profilesRes[0];

  const accountInfo = (await getBatchAccountInformation([{ address: profileDoc._docId, fetchOptions }]))[0];

  let fetchName = true;
  if (fetchOptions?.noExternalCalls) {
    fetchName = false;
  }

  const userInfos = await convertToBitBadgesUserInfo(req, res, [{ ...profileDoc }], [{ ...accountInfo }], fetchName); // Newly queried account isw added after bc there may be newer info (sequence, etc)
  let account = userInfos[0];

  if (fetchOptions) {
    // account is currently a BitBadgesUserInfo with no portfolio info
    const portfolioRes = await getAdditionalUserInfo(req, res, profileDoc, account.cosmosAddress, fetchOptions);
    account = new BitBadgesUserInfo({
      ...account,
      ...portfolioRes
    });
  }

  return account;
};

// Get by address, cosmosAddress, accountNumber, or username
// ENS names are not supported. Convert to address first
export const getAccounts = async (req: Request, res: Response<iGetAccountsSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetAccountsPayload;
    const validateRes: typia.IValidation<GetAccountsPayload> = typia.validate<GetAccountsPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const allDoNotHaveExternalCalls = reqPayload.accountsToFetch.every((x) => x.noExternalCalls);
    if (!allDoNotHaveExternalCalls && reqPayload.accountsToFetch.length > 250) {
      return res.status(400).send({
        errorMessage: 'You can only fetch up to 250 accounts with external calls at a time. Please structure your request accordingly.'
      });
    } else if (allDoNotHaveExternalCalls && reqPayload.accountsToFetch.length > 10000) {
      return res.status(400).send({
        errorMessage: 'You can only fetch up to 10,000 accounts without external calls at a time. Please structure your request accordingly.'
      });
    }

    const usernames = reqPayload.accountsToFetch
      .filter((x) => x.username)
      .map((x) => x.username)
      .filter((x) => x !== undefined) as string[];

    const profileDocs = await resolveUsernames(usernames);
    const allQueries = profileDocs.map((x) => {
      return {
        address: x._docId,
        fetchOptions: reqPayload.accountsToFetch.find((y) => y.username === x.username)
      };
    });

    for (const accountFetchOptions of reqPayload.accountsToFetch) {
      if (accountFetchOptions.address) {
        allQueries.push({
          address: accountFetchOptions.address,
          fetchOptions: accountFetchOptions
        });
      }
    }

    const accountInfos = await getBatchAccountInformation(allQueries);
    const profileInfos = await getBatchProfileInformation(req, res, allQueries);

    const userInfos = await convertToBitBadgesUserInfo(req, res, profileInfos, accountInfos, !allDoNotHaveExternalCalls);
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
            res,
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Error fetching accounts. ' + e.message
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
  siwbbRequests: Array<SIWBBRequestDoc<bigint>>;
  attestations: Array<AttestationDoc<bigint>>;
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
  res: Response,
  profileInfo: iProfileDoc<bigint>,
  cosmosAddress: string,
  reqPayload: AccountFetchOptions
): Promise<GetAdditionalUserInfoRes> => {
  if (!reqPayload.viewsToFetch) {
    return {
      collected: [],
      activity: [],
      listsActivity: [],
      reviews: [],
      attestations: [],
      addressLists: [],
      claimAlerts: [],
      siwbbRequests: [],
      views: {}
    };
  }

  const authReq = req as MaybeAuthenticatedRequest<NumberType>;
  const authDetails = await getAuthDetails(authReq, res);
  const asyncOperations = [];
  for (const view of reqPayload.viewsToFetch) {
    const bookmark = view.bookmark;
    const filteredCollections = view.specificCollections;
    const filteredLists = view.specificLists;
    const oldestFirst = view.oldestFirst;
    if (view.viewType === 'listsActivity') {
      if (bookmark !== undefined) {
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Address Lists' }])) &&
          !!authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        asyncOperations.push(async () => await executeListsActivityQuery(cosmosAddress, profileInfo, false, bookmark, oldestFirst, isAuthenticated));
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
        console.log(authDetails, cosmosAddress);
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Claim Alerts' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;

        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(async () => await executeClaimAlertsQuery(cosmosAddress, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'sentClaimAlerts') {
      if (bookmark !== undefined) {
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Claim Alerts' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch claim alerts.');
        asyncOperations.push(async () => await executeSentClaimAlertsQuery(cosmosAddress, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'siwbbRequests') {
      if (bookmark !== undefined) {
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Authentication Codes' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch authentication codes.');
        asyncOperations.push(async () => await executeSIWBBRequestsQuery(cosmosAddress, bookmark, oldestFirst));
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
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Address Lists' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch private lists.');
        asyncOperations.push(async () => await executePrivateListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'createdLists') {
      if (bookmark !== undefined) {
        asyncOperations.push(async () => await executeCreatedListsQuery(cosmosAddress, filteredLists, bookmark, oldestFirst));
      }
    } else if (view.viewType === 'createdAttestations') {
      if (bookmark !== undefined) {
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Attestations' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch account attestations.');
        asyncOperations.push(async () => await executeCreatedAttestationsQuery(cosmosAddress, bookmark));
      }
    } else if (view.viewType === 'receivedAttestations') {
      if (bookmark !== undefined) {
        const isAuthenticated =
          !!(await checkIfAuthenticated(authReq, res, [{ scopeName: 'Read Attestations' }])) &&
          authDetails &&
          authDetails.cosmosAddress === cosmosAddress;
        if (!isAuthenticated) throw new Error('You must be authenticated to fetch account attestations.');
        asyncOperations.push(async () => await executeReceivedAttestationsQuery(cosmosAddress, bookmark));
      }
    }
  }

  let urisToFetch: string[] = [];

  const results = await Promise.all(asyncOperations.map(async (operation) => await operation()));
  const addressListIdsToFetch: Array<{ collectionId?: NumberType; listId: string }> = [];
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqPayload.viewsToFetch[i].viewType;

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
        urisToFetch = [
          ...[balance].flatMap((x) => x.incomingApprovals.map((y) => y.uri)),
          ...[balance].flatMap((x) => x.outgoingApprovals.map((y) => y.uri)),
          ...[balance].flatMap((x) => x.incomingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri))),
          ...[balance].flatMap((x) => x.outgoingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri)))
        ]
          .filter((x) => x)
          .filter((x, i, arr) => arr.indexOf(x) === i) as string[];

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

  const addressListsToPopulate = await getAddressListsFromDB(addressListIdsToFetch, true, false, undefined, true);
  const views: Record<string, { ids: string[]; type: string; pagination: PaginationInfo } | undefined> = {};
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqPayload.viewsToFetch[i].viewType;
    const viewId = reqPayload.viewsToFetch[i].viewId;

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
    } else if (viewKey === 'siwbbRequests') {
      const result = results[i] as nano.MangoResponse<SIWBBRequestDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Siwbb Requests',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: false // we fetch all Siwbb requests if requested
        }
      };
    } else if (viewKey === 'createdAttestations' || viewKey === 'receivedAttestations') {
      const result = results[i] as nano.MangoResponse<AttestationDoc<bigint>>;
      views[viewId] = {
        ids: result.docs.map((x) => x._docId),
        type: 'Attestations',
        pagination: {
          bookmark: result.bookmark ? result.bookmark : '',
          hasMore: result.docs.length >= 25
        }
      };
    } else if (viewKey === 'claimAlerts' || viewKey === 'sentClaimAlerts') {
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

  // const claimFetchResults = await fetchUrisFromDbAndAddToQueueIfEmpty(urisToFetch, ''); //TODO:
  const claimFetchResults = await getManyFromDB(FetchModel, urisToFetch);

  const responseObj: GetAdditionalUserInfoRes = {
    collected: [],
    activity: [],
    listsActivity: [],
    reviews: [],
    addressLists: [],
    claimAlerts: [],
    siwbbRequests: [],
    attestations: [],
    views: {}
  };
  for (let i = 0; i < results.length; i++) {
    const viewKey = reqPayload.viewsToFetch[i].viewType;
    if (viewKey === 'listsActivity') {
      const result = results[i] as nano.MangoResponse<ListActivityDoc<bigint>>;
      responseObj.listsActivity = result.docs;
    } else if (viewKey === 'badgesCollected') {
      const result = results[i] as nano.MangoResponse<BalanceDoc<bigint>>;
      responseObj.collected = [...responseObj.collected, ...result.docs].map((collected) => {
        const newIncomingApprovals = appendSelfInitiatedIncomingApprovalToApprovals(collected, addressListsToPopulate, cosmosAddress).map((x) => {
          return {
            ...x,
            details: claimFetchResults.find((y) => y?._docId === x.uri)?.content as iApprovalInfoDetails | undefined,
            approvalCriteria: addChallengeDetailsToCriteria(
              x.approvalCriteria,
              claimFetchResults as ({ uri: string; content: iChallengeDetails<NumberType> | undefined } | undefined)[]
            )
          };
        });
        const newOutgoingApprovals = appendSelfInitiatedOutgoingApprovalToApprovals(collected, addressListsToPopulate, cosmosAddress).map((x) => {
          return {
            ...x,
            details: claimFetchResults.find((y) => y?._docId === x.uri)?.content as iApprovalInfoDetails | undefined,
            approvalCriteria: addChallengeDetailsToCriteria(
              x.approvalCriteria,
              claimFetchResults as ({ uri: string; content: iChallengeDetails<NumberType> | undefined } | undefined)[]
            )
          };
        });

        const newUserPermissions = applyAddressListsToUserPermissions(collected.userPermissions, addressListsToPopulate);

        return new BalanceDocWithDetails<NumberType>({
          ...collected,
          incomingApprovals: newIncomingApprovals,
          outgoingApprovals: newOutgoingApprovals,
          userPermissions: newUserPermissions
        }).convert(BigIntify);
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
    } else if (viewKey === 'claimAlerts' || viewKey === 'sentClaimAlerts') {
      const result = results[i] as nano.MangoResponse<ClaimAlertDoc<bigint>>;
      responseObj.claimAlerts = [...responseObj.claimAlerts, ...result.docs];
    } else if (viewKey === 'siwbbRequests') {
      const result = results[i] as nano.MangoResponse<SIWBBRequestDoc<bigint>>;
      responseObj.siwbbRequests = result.docs;
    } else if (viewKey === 'createdAttestations' || viewKey === 'receivedAttestations') {
      const result = results[i] as nano.MangoResponse<AttestationDoc<bigint>>;
      responseObj.attestations = [...responseObj.attestations, ...result.docs];
    }
    // nothing to do with managing or createdBy
  }

  responseObj.views = views;

  return responseObj;
};

export const updateAccountInfo = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateAccountInfoSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as UpdateAccountInfoPayload;
    const validateRes: typia.IValidation<UpdateAccountInfoPayload> = typia.validate<UpdateAccountInfoPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    setMockSessionIfTestMode(req);

    const authDetails = await mustGetAuthDetails(req, res);
    const cosmosAddress = authDetails.cosmosAddress;

    if (Object.keys(reqPayload).length === 1 && reqPayload.seenActivity !== undefined) {
      if (!checkIfAuthenticated(req, res, [{ scopeName: 'Read Profile' }])) {
        return;
      }
    } else {
      if (!checkIfAuthenticated(req, res, [{ scopeName: 'Full Access' }])) {
        return;
      }
    }

    let profileInfo = await getFromDB(ProfileModel, cosmosAddress);
    if (!profileInfo) {
      profileInfo = new ProfileDoc({
        _docId: cosmosAddress,
        createdAt: BigInt(Date.now())
      });
    }

    if (
      [
        ...(reqPayload.customPages?.badges ?? []),
        ...(reqPayload.customPages?.lists ?? []),
        ...(reqPayload.watchlists?.badges ?? []),
        ...(reqPayload.watchlists?.lists ?? [])
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

    if (reqPayload.username) {
      // No . in username allowed
      // Do standard username regex
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(reqPayload.username)) {
        return res.status(400).send({
          errorMessage: 'Username must be 1 to 15 characters long and can only contain letters, numbers, and underscores.'
        });
      }
    }

    const file = reqPayload.profilePicImageFile;
    let profilePicUrl = reqPayload.profilePicUrl;
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
      discord: reqPayload.discord ?? profileInfo.discord,
      twitter: reqPayload.twitter ?? profileInfo.twitter,
      github: reqPayload.github ?? profileInfo.github,
      telegram: reqPayload.telegram ?? profileInfo.telegram,
      seenActivity: reqPayload.seenActivity?.toString() ?? profileInfo.seenActivity,
      readme: reqPayload.readme ?? profileInfo.readme,
      hiddenBadges: reqPayload.hiddenBadges ?? profileInfo.hiddenBadges,
      customLinks: reqPayload.customLinks ?? profileInfo.customLinks,
      customPages: reqPayload.customPages ?? profileInfo.customPages,
      watchlists: reqPayload.watchlists ?? profileInfo.watchlists,
      hiddenLists: reqPayload.hiddenLists ?? profileInfo.hiddenLists,
      profilePicUrl: profilePicUrl ?? profileInfo.profilePicUrl,
      username: reqPayload.username ?? profileInfo.username,
      approvedSignInMethods: reqPayload.approvedSignInMethods ?? profileInfo.approvedSignInMethods
    });

    const profileSize = JSON.stringify(newProfileInfo).length;
    if (profileSize > 100000) {
      return res.status(400).send({
        errorMessage: 'Profile information is too large to store. Please reduce the size of the details for your profile.'
      });
    }

    newProfileInfo.notifications = new NotificationPreferences({ ...profileInfo.notifications });
    if (reqPayload.notifications) {
      if (reqPayload.notifications.discord !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.discord = { ...reqPayload.notifications.discord, token: profileInfo.notifications?.discord?.token ?? '' };

        //Compare to current. If different, check session
        const currId = profileInfo.notifications?.discord?.id;
        if (reqPayload.notifications.discord.id && currId !== reqPayload.notifications.discord.id) {
          if (authDetails.discord?.id !== reqPayload.notifications.discord.id) {
            return res.status(400).send({
              errorMessage: 'Discord ID does not match your current connected Discord.'
            });
          }

          const uniqueToken = crypto.randomBytes(32).toString('hex');
          newProfileInfo.notifications.discord.token = uniqueToken;
        }
      }

      if (reqPayload.notifications.email !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.email = reqPayload.notifications.email;

        if (reqPayload.notifications.email) {
          // Is valid email - regex
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reqPayload.notifications.email)) {
            return res.status(400).send({
              errorMessage: 'Email is not valid.'
            });
          }

          const isCurrentlyVerified =
            profileInfo.notifications?.emailVerification?.verified && profileInfo.notifications?.email === reqPayload.notifications.email;

          if (!isCurrentlyVerified) {
            const uniqueToken = crypto.randomBytes(32).toString('hex');

            newProfileInfo.notifications.emailVerification = new EmailVerificationStatus({
              ...newProfileInfo.notifications.emailVerification,
              verified: false,
              token: uniqueToken,
              expiry: Number(Date.now() + 1000 * 60 * 60 * 1) // 1 hour
            });

            const emails: Array<{
              to: string;
              from: string;
              subject: string;
              html: string;
            }> = [
              {
                to: reqPayload.notifications.email,
                from: 'info@mail.bitbadges.io',
                subject: 'Verify your email',
                html: VerificationEmailHTML(uniqueToken, reqPayload.notifications.antiPhishingCode ?? '')
              }
            ];
            sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
            await sgMail.send(emails, true);
          }
        } else {
          newProfileInfo.notifications.emailVerification = undefined;
        }
      }

      if (reqPayload.notifications.antiPhishingCode !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.emailVerification = newProfileInfo.notifications.emailVerification ?? new EmailVerificationStatus({});
        newProfileInfo.notifications.emailVerification.antiPhishingCode = reqPayload.notifications.antiPhishingCode;
      }

      if (reqPayload.notifications.preferences !== undefined) {
        newProfileInfo.notifications = newProfileInfo.notifications ?? new NotificationPreferences({});
        newProfileInfo.notifications.preferences = reqPayload.notifications.preferences;
      }
    }

    // Delete any previous usernames

    // We could probably have a more bulletproof way of doing this, but this is fine for now
    // Didn't want to introduce sessions into this
    // 1. Check if new username exists. If not, claim it
    // 2. Delete any previous usernames
    if (reqPayload.username && reqPayload.username !== profileInfo.username) {
      // fail if already taken (upsert = false)
      try {
        await UsernameModel.create([{ _docId: reqPayload.username }]);
        const previouslyHadUsername = !!profileInfo.username;
        if (previouslyHadUsername && profileInfo.username) await deleteMany(UsernameModel, [profileInfo.username]);
      } catch (e) {
        throw new Error('Username already taken');
      }
    }

    await insertToDB(ProfileModel, newProfileInfo);

    return res.status(200).send({});
  } catch (e) {
    console.log('Error updating account info', e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Error updating account info. ' + e.message
    });
  }
};

export const VerificationEmailHTML = (emailToken: string, antiPhishingCode: string) => {
  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
      <!--[if !mso]><!-->
      <meta http-equiv="X-UA-Compatible" content="IE=Edge">
      <!--<![endif]-->
      <!--[if (gte mso 9)|(IE)]>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
      <![endif]-->
      <!--[if (gte mso 9)|(IE)]>
  <style type="text/css">
    body {width: 600px;margin: 0 auto;}
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
<![endif]-->
      <style type="text/css">
    body, p, div {
      font-family: arial,helvetica,sans-serif;
      font-size: 14px;
    }
    body {
      color: #000000;
    }
    body a {
      color: #1188E6;
      text-decoration: none;
    }
    p { margin: 0; padding: 0; }
    table.wrapper {
      width:100% !important;
      table-layout: fixed;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    img.max-width {
      max-width: 100% !important;
    }
    .column.of-2 {
      width: 50%;
    }
    .column.of-3 {
      width: 33.333%;
    }
    .column.of-4 {
      width: 25%;
    }
    ul ul ul ul  {
      list-style-type: disc !important;
    }
    ol ol {
      list-style-type: lower-roman !important;
    }
    ol ol ol {
      list-style-type: lower-latin !important;
    }
    ol ol ol ol {
      list-style-type: decimal !important;
    }
    @media screen and (max-width:480px) {
      .preheader .rightColumnContent,
      .footer .rightColumnContent {
        text-align: left !important;
      }
      .preheader .rightColumnContent div,
      .preheader .rightColumnContent span,
      .footer .rightColumnContent div,
      .footer .rightColumnContent span {
        text-align: left !important;
      }
      .preheader .rightColumnContent,
      .preheader .leftColumnContent {
        font-size: 80% !important;
        padding: 5px 0;
      }
      table.wrapper-mobile {
        width: 100% !important;
        table-layout: fixed;
      }
      img.max-width {
        height: auto !important;
        max-width: 100% !important;
      }
      a.bulletproof-button {
        display: block !important;
        width: auto !important;
        font-size: 80%;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .columns {
        width: 100% !important;
      }
      .column {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .social-icon-column {
        display: inline-block !important;
      }
    }
  </style>
      <!--user entered Head Start--><!--End Head user entered-->
    </head>
    <body>
      <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
        <div class="webkit">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
            <tr>
              <td valign="top" bgcolor="#FFFFFF" width="100%">
                <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="100%">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td>
                            <!--[if mso]>
    <center>sendg
    <table><tr><td width="600">
  <![endif]-->
                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                      <tr>
                                        <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    <tr>
      <td role="module-content">
        <p></p>
      </td>
    </tr>
  </table><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="03460a48-1a16-4fa3-9d8d-2e55003bcefb">
    <tbody>
      <tr>
        <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
          <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="600" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/6ef6241ea0a2dae3/3f99226a-9d32-45fd-baa6-5712ef69edf2/1478x309.png">
        </td>
      </tr>
    </tbody>
  </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="6a9044d8-176b-46e3-9b3a-8bdd5d60a505" data-mc-module-version="2019-10-22">
    <tbody>
      <tr>
        <td style="padding:12px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">Please verify your BitBadges email by:</div>
<ol>
  <li style="text-align: inherit">Going to https://bitbadges.io/email-verify</li>
  <li style="text-align: inherit">Enter your verification code: <strong>${emailToken}</strong></li>
</ol>
<div style="font-family: inherit; text-align: inherit"><br></div>
<div style="font-family: inherit; text-align: inherit">Your anti-phishing code is: <strong>${antiPhishingCode}</strong></div>
<div style="font-family: inherit; text-align: inherit"><span style="font-size: 12px">Please make sure this matches the one you set in your BitBadges account.All emails from BitBadges will include this code.</span></div>
<div style="font-family: inherit; text-align: inherit"><br>
<span style="font-family: Söhne, ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, Ubuntu, Cantarell, &quot;Noto Sans&quot;, sans-serif, &quot;Helvetica Neue&quot;, Arial, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space-collapse: preserve; text-wrap: wrap; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; float: none; display: inline; font-size: 12px">Attention: Beware of phishing attempts in the crypto space. Scammers often impersonate legitimate platforms or individuals to trick users into revealing sensitive information or transferring funds. Always verify the authenticity of any communication before taking action, and never share your private keys or passwords. Stay vigilant and prioritize security to protect your assets from potential threats.</span></div>
<div style="font-family: inherit; text-align: inherit"><br></div>
<div style="font-family: inherit; text-align: inherit"><span style="font-family: Söhne, ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, Ubuntu, Cantarell, &quot;Noto Sans&quot;, sans-serif, &quot;Helvetica Neue&quot;, Arial, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space-collapse: preserve; text-wrap: wrap; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; float: none; display: inline; font-size: 12px">BitBadges will never ask for your private key or any private information over email. Always verify that BitBadges emails come from @mail.bitbadges.io. We will also not make you click any links from any emails.</span></div><div></div></div></td>
      </tr>
    </tbody>
  </table>
      </center>
    </body>
  </html>
  `;
};
