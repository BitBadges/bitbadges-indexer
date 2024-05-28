import {
  ApprovalTrackerDoc,
  BadgeMetadataDetails,
  BadgeMetadataTimelineWithDetails,
  BalanceArray,
  BalanceDocWithDetails,
  BigIntify,
  BitBadgesCollection,
  ClaimDetails,
  CollectionApprovalWithDetails,
  CollectionMetadataDetails,
  CollectionMetadataTimelineWithDetails,
  CollectionPermissionsWithDetails,
  GO_MAX_UINT_64,
  MerkleChallengeDoc,
  Metadata,
  UintRangeArray,
  UserBalanceStoreWithDetails,
  UserIncomingApprovalWithDetails,
  UserOutgoingApprovalWithDetails,
  UserPermissionsWithDetails,
  convertToCosmosAddress,
  getFullBadgeMetadataTimeline,
  getFullCollectionMetadataTimeline,
  getFullCustomDataTimeline,
  getFullIsArchivedTimeline,
  getFullManagerTimeline,
  getFullStandardsTimeline,
  getOffChainBalancesMetadataTimeline,
  iApprovalInfoDetails,
  iChallengeDetails,
  iChallengeTrackerIdDetails,
  iClaimDetails,
  type ApprovalInfoDetails,
  type BadgeMetadata,
  type BalanceDoc,
  type ChallengeDetails,
  type ClaimBuilderDoc,
  type ClaimIntegrationPluginType,
  type CollectionDoc,
  type ErrorResponse,
  type GetAdditionalCollectionDetailsPayload,
  type GetBadgeActivityPayload,
  type GetCollectionsPayload,
  type GetMetadataForCollectionPayload,
  type IntegrationPluginDetails,
  type IntegrationPluginParams,
  type MetadataFetchOptions,
  type NumberType,
  type PaginationInfo,
  type ReviewDoc,
  type TransferActivityDoc,
  type UintRange,
  type iAddressList,
  type iApprovalTrackerDoc,
  type iGetBadgeActivitySuccessResponse,
  type iGetCollectionsSuccessResponse,
  type iMerkleChallengeDoc
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, checkIfManager, mustGetAuthDetails, type MaybeAuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertToDB, mustGetManyFromDB } from '../db/db';
import { PageVisitsDoc } from '../db/docs';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel, CollectionModel, MapModel, PageVisitsModel } from '../db/schemas';
import { getPlugin } from '../integrations/types';
import { complianceDoc } from '../poll';
import { fetchUrisFromDbAndAddToQueueIfEmpty } from '../queue';
import {
  executeApprovalTrackersByIdsQuery,
  executeBadgeActivityQuery,
  executeCollectionActivityQuery,
  executeCollectionApprovalTrackersQuery,
  executeCollectionBalancesQuery,
  executeCollectionMerkleChallengesQuery,
  executeCollectionReviewsQuery,
  executeMerkleChallengeByIdsQuery,
  fetchTotalAndUnmintedBalancesQuery
} from './activityHelpers';
import { addChallengeDetailsToCriteria } from './badges';
import { applyAddressListsToUserPermissions } from './balances';
import { getDecryptedActionSeedCode } from './claims';
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from './utils';

const { batchUpdateBadgeMetadata } = BadgeMetadataDetails;

/**
 * The executeCollectionsQuery function is the main query function used to fetch all data for a collection in bulk.
 *
 * collectionId - The collectionId of the collection to fetch
 * metadataToFetch: - Options for fetching metadata. Default we just fetch the collection metadata.
 *  - doNotFetchCollectionMetadata: If true, we do not fetch the collection metadata.
 *  - metadataIds: The metadataIds to fetch.
 *  - uris: The uris to fetch. Will throw an error if uri does not match any URI in the collection.
 *  - badgeIds: The badgeIds to fetch. Will throw an error if badgeId does not match any badgeId in the collection.
 *
 * Bookmarks are used for pagination. If a bookmark is '', the query will start from the beginning. If a bookmark is undefined, the query will not fetch that data.
 *
 * activityBookmark - The bookmark to start fetching activity from.
 * announcementsBookmark - The bookmark to start fetching announcements from.
 * reviewsBookmark - The bookmark to start fetching reviews from.
 * ownersBookmark - The bookmark to start fetching balances from.
 * claimsBookmark - The bookmark to start fetching claims from.
 */
export type CollectionQueryOptions = {
  collectionId: NumberType;
} & GetMetadataForCollectionPayload &
  GetAdditionalCollectionDetailsPayload;

export async function executeAdditionalCollectionQueries(
  req: Request,
  res: Response,
  baseCollections: Array<CollectionDoc<bigint>>,
  collectionQueries: CollectionQueryOptions[]
) {
  const promises = [];
  const collectionResponses: Array<BitBadgesCollection<bigint>> = [];

  const balanceResIdxs = [];
  // Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    const collectionUri = collection.getCollectionMetadataTimelineValue()?.uri ?? '';
    const badgeMetadata = collection.getBadgeMetadataTimelineValue();

    promises.push(getMetadata(collection.collectionId.toString(), collectionUri, badgeMetadata, query.metadataToFetch));

    for (const view of query.viewsToFetch ?? []) {
      const bookmark = view.bookmark;
      const oldestFirst = view.oldestFirst;
      if (view.viewType === 'transferActivity') {
        if (bookmark !== undefined) {
          promises.push(
            executeCollectionActivityQuery(`${query.collectionId}`, bookmark, oldestFirst, convertToCosmosAddress(view.cosmosAddress ?? ''))
          );
        }
      } else if (view.viewType === 'reviews') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionReviewsQuery(`${query.collectionId}`, bookmark, oldestFirst));
        }
      } else if (view.viewType === 'owners') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionBalancesQuery(`${query.collectionId}`, bookmark, oldestFirst));
          balanceResIdxs.push(promises.length - 1);
        }
      } else if (view.viewType === 'challengeTrackers') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionMerkleChallengesQuery(`${query.collectionId}`, bookmark, oldestFirst));
        }
      } else if (view.viewType === 'amountTrackers') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionApprovalTrackersQuery(`${query.collectionId}`, bookmark, oldestFirst));
        }
      }
    }

    if (query.challengeTrackersToFetch?.length) {
      promises.push(executeMerkleChallengeByIdsQuery(`${query.collectionId}`, query.challengeTrackersToFetch));
    }

    if (query.approvalTrackersToFetch?.length) {
      promises.push(executeApprovalTrackersByIdsQuery(`${query.collectionId}`, query.approvalTrackersToFetch));
    }

    if (query.fetchTotalAndMintBalances) {
      promises.push(fetchTotalAndUnmintedBalancesQuery(`${query.collectionId}`));
      balanceResIdxs.push(promises.length - 1);
    }
  }

  // Parse results and add to collectionResponses
  const responses = await Promise.all(promises);

  const addressListIdsToFetch: Array<{ collectionId: NumberType; listId: string }> = [];
  let currPromiseIdx = 0;
  for (const query of collectionQueries) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collectionRes) continue;

    for (const collectionApprovalVal of collectionRes.collectionApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: collectionApprovalVal.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: collectionApprovalVal.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: collectionApprovalVal.initiatedByListId
      });
    }

    for (const incomingPermission of collectionRes.defaultBalances.userPermissions.canUpdateIncomingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: incomingPermission.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: incomingPermission.initiatedByListId
      });
    }

    for (const outgoingPermission of collectionRes.defaultBalances.userPermissions.canUpdateOutgoingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: outgoingPermission.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: outgoingPermission.initiatedByListId
      });
    }

    for (const permission of collectionRes.collectionPermissions.canUpdateCollectionApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: permission.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: permission.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: permission.initiatedByListId
      });
    }

    for (const transfer of collectionRes.defaultBalances.incomingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: transfer.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: transfer.initiatedByListId
      });
    }

    for (const transfer of collectionRes.defaultBalances.outgoingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: transfer.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId,
        listId: transfer.initiatedByListId
      });
    }

    for (const idx of balanceResIdxs) {
      const balanceRes = responses[idx] as {
        docs: Array<BalanceDoc<bigint>>;
        pagination: PaginationInfo;
      };
      for (const balanceDoc of balanceRes.docs) {
        for (const transfer of balanceDoc.incomingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.fromListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.initiatedByListId
          });
        }

        for (const transfer of balanceDoc.outgoingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.toListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.initiatedByListId
          });
        }

        for (const transfer of balanceDoc.userPermissions.canUpdateIncomingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.fromListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.initiatedByListId
          });
        }

        for (const transfer of balanceDoc.userPermissions.canUpdateOutgoingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.toListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId,
            listId: transfer.initiatedByListId
          });
        }
      }
    }
  }

  const claimFetchesPromises = [];
  for (const collectionRes of baseCollections) {
    const collectionId = collectionRes.collectionId;
    const urisToFetch = [];
    for (const approval of collectionRes.collectionApprovals) {
      const uri = approval.uri;
      if (uri) urisToFetch.push(uri);
    }

    for (const merkleChallenge of collectionRes.collectionApprovals.flatMap((x) => x.approvalCriteria?.merkleChallenges ?? [])) {
      const uri = merkleChallenge.uri;
      if (uri) urisToFetch.push(uri);
    }

    for (const idx of balanceResIdxs) {
      const balanceRes = responses[idx] as {
        docs: Array<BalanceDoc<bigint>>;
        pagination: PaginationInfo;
      };
      for (const balanceDoc of balanceRes.docs) {
        for (const transfer of balanceDoc.incomingApprovals) {
          const uri = transfer.uri;
          if (uri) urisToFetch.push(uri);
        }

        for (const transfer of balanceDoc.outgoingApprovals) {
          const uri = transfer.uri;
          if (uri) urisToFetch.push(uri);
        }

        for (const merkleChallenge of balanceDoc.incomingApprovals.flatMap((x) => x.approvalCriteria?.merkleChallenges ?? [])) {
          const uri = merkleChallenge.uri;
          if (uri) urisToFetch.push(uri);
        }

        for (const merkleChallenge of balanceDoc.outgoingApprovals.flatMap((x) => x.approvalCriteria?.merkleChallenges ?? [])) {
          const uri = merkleChallenge.uri;
          if (uri) urisToFetch.push(uri);
        }
      }
    }

    if (urisToFetch.length > 0) {
      claimFetchesPromises.push(
        fetchUrisFromDbAndAddToQueueIfEmpty(
          [...new Set(urisToFetch)].filter((x) => x),
          collectionId.toString()
        )
      );
    }
  }

  const addressListsPromise = getAddressListsFromDB(addressListIdsToFetch, false);

  const [addressLists, claimFetches] = await Promise.all([addressListsPromise, Promise.all(claimFetchesPromises)]);
  const claimFetchesFlat = claimFetches.flat();

  const badgeIdsFetched = new Array<UintRangeArray<bigint>>();
  for (const query of collectionQueries) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collectionRes) continue;

    const isNSFW = complianceDoc?.badges?.nsfw?.find((x) => BigInt(x.collectionId) === BigInt(collectionRes.collectionId));
    const isReported = complianceDoc?.badges?.reported?.find((x) => BigInt(x.collectionId) === BigInt(collectionRes.collectionId));

    const collectionToReturn = new BitBadgesCollection<bigint>({
      ...collectionRes,
      nsfw: isNSFW ? { ...isNSFW, reason: '' } : undefined,
      reported: isReported ? { ...isReported, reason: '' } : undefined,
      collectionApprovals: collectionRes.collectionApprovals.map(
        (x) =>
          new CollectionApprovalWithDetails({
            ...x,
            fromList: addressLists.find((list) => list.listId === x.fromListId) as iAddressList,
            toList: addressLists.find((list) => list.listId === x.toListId) as iAddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as iAddressList,
            approvalCriteria: {
              ...x.approvalCriteria,
              merkleChallenges:
                x.approvalCriteria?.merkleChallenges?.map((y) => {
                  return {
                    ...y,
                    challengeInfoDetails: {
                      challengeDetails: {
                        leaves: [],
                        isHashed: false
                      }
                    }
                  };
                }) ?? []
            }
          })
      ),
      defaultBalances: new UserBalanceStoreWithDetails<bigint>({
        ...collectionRes.defaultBalances,
        outgoingApprovals: collectionRes.defaultBalances.outgoingApprovals.map((x) => {
          return {
            ...x,
            toList: addressLists.find((list) => list.listId === x.toListId) as iAddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as iAddressList,
            approvalCriteria: {
              ...x.approvalCriteria,
              merkleChallenges:
                x.approvalCriteria?.merkleChallenges?.map((y) => {
                  return {
                    ...y,
                    challengeInfoDetails: {
                      challengeDetails: {
                        leaves: [],
                        isHashed: false
                      }
                    }
                  };
                }) ?? []
            }
          };
        }),
        incomingApprovals: collectionRes.defaultBalances.incomingApprovals.map((x) => {
          return {
            ...x,
            fromList: addressLists.find((list) => list.listId === x.fromListId) as iAddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as iAddressList,
            approvalCriteria: {
              ...x.approvalCriteria,
              merkleChallenges:
                x.approvalCriteria?.merkleChallenges?.map((y) => {
                  return {
                    ...y,
                    challengeInfoDetails: {
                      challengeDetails: {
                        leaves: [],
                        isHashed: false
                      }
                    }
                  };
                }) ?? []
            }
          };
        }),
        userPermissions: applyAddressListsToUserPermissions(collectionRes.defaultBalances.userPermissions, addressLists)
      }),
      collectionPermissions: new CollectionPermissionsWithDetails({
        ...collectionRes.collectionPermissions,
        canUpdateCollectionApprovals: collectionRes.collectionPermissions.canUpdateCollectionApprovals.map((x) => {
          return {
            ...x,
            fromList: addressLists.find((list) => list.listId === x.fromListId) as iAddressList,
            toList: addressLists.find((list) => list.listId === x.toListId) as iAddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as iAddressList
          };
        })
      }),

      // Placeholders to be replaced later in function
      activity: [],
      reviews: [],
      owners: [],
      merkleChallenges: [],
      approvalTrackers: [],

      claims: [],
      views: {}
    });

    const metadataRes = responses[currPromiseIdx++] as {
      collectionMetadata: CollectionMetadataDetails<bigint>;
      badgeMetadata: Array<BadgeMetadataDetails<bigint>>;
    };

    badgeIdsFetched.push(UintRangeArray.From(metadataRes.badgeMetadata.map((x) => x.badgeIds).flat()));
    const getBalanceDocsWithDetails = (docs: Array<BalanceDoc<bigint>>) => {
      return docs.map(
        (doc) =>
          new BalanceDocWithDetails<bigint>({
            ...doc,
            incomingApprovals: doc.incomingApprovals.map((x) => {
              return new UserIncomingApprovalWithDetails({
                ...x,
                details: claimFetchesFlat.find((y) => y.uri === x.uri) as iApprovalInfoDetails | undefined,
                fromList: addressLists.find((z) => z.listId === x.fromListId) as iAddressList,
                initiatedByList: addressLists.find((z) => z.listId === x.initiatedByListId) as iAddressList,
                approvalCriteria: addChallengeDetailsToCriteria(
                  x.approvalCriteria,
                  claimFetchesFlat as { uri: string; content: iChallengeDetails<NumberType> | undefined }[]
                )
              }).convert(BigIntify);
            }),
            outgoingApprovals: doc.outgoingApprovals.map((x) => {
              return new UserOutgoingApprovalWithDetails({
                ...x,
                details: claimFetchesFlat.find((y) => y.uri === x.uri) as iApprovalInfoDetails | undefined,
                toList: addressLists.find((z) => z.listId === x.toListId) as iAddressList,
                initiatedByList: addressLists.find((z) => z.listId === x.initiatedByListId) as iAddressList,
                approvalCriteria: addChallengeDetailsToCriteria(
                  x.approvalCriteria,
                  claimFetchesFlat as { uri: string; content: iChallengeDetails<NumberType> | undefined }[]
                )
              }).convert(BigIntify);
            }),
            userPermissions: new UserPermissionsWithDetails({
              ...doc.userPermissions,
              canUpdateIncomingApprovals: doc.userPermissions.canUpdateIncomingApprovals.map((x) => {
                return {
                  ...x,
                  fromList: addressLists.find((z) => z.listId === x.fromListId) as iAddressList,
                  initiatedByList: addressLists.find((z) => z.listId === x.initiatedByListId) as iAddressList
                };
              }),
              canUpdateOutgoingApprovals: doc.userPermissions.canUpdateOutgoingApprovals.map((x) => {
                return {
                  ...x,
                  toList: addressLists.find((z) => z.listId === x.toListId) as iAddressList,
                  initiatedByList: addressLists.find((z) => z.listId === x.initiatedByListId) as iAddressList
                };
              })
            })
          })
      );
    };

    if (query.viewsToFetch?.length) {
      for (let j = 0; j < (query.viewsToFetch ?? [])?.length; j++) {
        const view = query.viewsToFetch[j];
        const genericViewRes = responses[currPromiseIdx] as {
          docs: any[];
          pagination: PaginationInfo;
        };
        let type = 'Activity';
        if (view.viewType === 'transferActivity') {
          const viewRes = responses[currPromiseIdx++] as {
            docs: Array<TransferActivityDoc<bigint>>;
            pagination: PaginationInfo;
          };
          collectionToReturn.activity.push(...viewRes.docs);
          type = 'Activity';
        } else if (view.viewType === 'reviews') {
          const viewRes = responses[currPromiseIdx++] as {
            docs: Array<ReviewDoc<bigint>>;
            pagination: PaginationInfo;
          };
          collectionToReturn.reviews.push(...viewRes.docs);
          type = 'Review';
        } else if (view.viewType === 'owners') {
          const viewRes = responses[currPromiseIdx++] as {
            docs: Array<BalanceDoc<bigint>>;
            pagination: PaginationInfo;
          };
          collectionToReturn.owners.push(...getBalanceDocsWithDetails(viewRes.docs));
          type = 'Balance';
        } else if (view.viewType === 'challengeTrackers') {
          const viewRes = responses[currPromiseIdx++] as {
            docs: Array<MerkleChallengeDoc<bigint>>;
            pagination: PaginationInfo;
          };
          collectionToReturn.merkleChallenges.push(...viewRes.docs);
          type = 'MerkleChallenge';
        } else if (view.viewType === 'amountTrackers') {
          const viewRes = responses[currPromiseIdx++] as {
            docs: Array<ApprovalTrackerDoc<bigint>>;
            pagination: PaginationInfo;
          };
          collectionToReturn.approvalTrackers.push(...viewRes.docs);
          type = 'ApprovalTracker';
        }

        collectionToReturn.views[view.viewId] = {
          ids: genericViewRes.docs.map((doc) => doc._docId),
          type,
          pagination: {
            bookmark: genericViewRes.pagination.bookmark || '',
            hasMore: genericViewRes.docs.length === 25
          }
        };
      }
    }

    if (query.challengeTrackersToFetch?.length) {
      const merkleChallengeRes = responses[currPromiseIdx++] as Array<iMerkleChallengeDoc<bigint>>;
      collectionToReturn.merkleChallenges.push(...merkleChallengeRes.map((x) => new MerkleChallengeDoc(x)));
    }

    if (query.approvalTrackersToFetch?.length) {
      const approvalTrackerRes = responses[currPromiseIdx++] as Array<iApprovalTrackerDoc<bigint>>;
      collectionToReturn.approvalTrackers.push(...approvalTrackerRes.map((x) => new ApprovalTrackerDoc(x)));
    }

    if (query.fetchTotalAndMintBalances) {
      const mintAndTotalBalancesRes = responses[currPromiseIdx++] as {
        docs: Array<BalanceDoc<bigint>>;
        pagination: PaginationInfo;
      };
      collectionToReturn.owners.push(...getBalanceDocsWithDetails(mintAndTotalBalancesRes.docs));
    }

    // Remove duplicates
    collectionToReturn.activity = collectionToReturn.activity.filter(
      (activity, index, self) => self.findIndex((t) => t._docId === activity._docId) === index
    );
    collectionToReturn.reviews = collectionToReturn.reviews.filter(
      (review, index, self) => self.findIndex((t) => t._docId === review._docId) === index
    );
    collectionToReturn.owners = collectionToReturn.owners.filter((owner, index, self) => self.findIndex((t) => t._docId === owner._docId) === index);
    collectionToReturn.merkleChallenges = collectionToReturn.merkleChallenges.filter(
      (merkleChallenge, index, self) => self.findIndex((t) => t._docId === merkleChallenge._docId) === index
    );
    collectionToReturn.approvalTrackers = collectionToReturn.approvalTrackers.filter(
      (approvalTracker, index, self) => self.findIndex((t) => t._docId === approvalTracker._docId) === index
    );

    const appendedCollection = appendMetadataResToCollection(metadataRes, collectionToReturn);
    collectionToReturn.badgeMetadataTimeline = appendedCollection.badgeMetadataTimeline;
    collectionToReturn.collectionMetadataTimeline = appendedCollection.collectionMetadataTimeline;
    if (query.handleAllAndAppendDefaults) {
      // Convert all timelines to handle all possible timeline time values
      collectionToReturn.collectionMetadataTimeline = getFullCollectionMetadataTimeline(
        collectionToReturn.collectionMetadataTimeline
      ) as unknown as CollectionMetadataTimelineWithDetails<bigint>[];
      collectionToReturn.badgeMetadataTimeline = getFullBadgeMetadataTimeline(
        collectionToReturn.badgeMetadataTimeline
      ) as unknown as BadgeMetadataTimelineWithDetails<bigint>[];
      collectionToReturn.isArchivedTimeline = getFullIsArchivedTimeline(collectionToReturn.isArchivedTimeline);
      collectionToReturn.offChainBalancesMetadataTimeline = getOffChainBalancesMetadataTimeline(collectionToReturn.offChainBalancesMetadataTimeline);
      collectionToReturn.customDataTimeline = getFullCustomDataTimeline(collectionToReturn.customDataTimeline);
      collectionToReturn.standardsTimeline = getFullStandardsTimeline(collectionToReturn.standardsTimeline);
      collectionToReturn.managerTimeline = getFullManagerTimeline(collectionToReturn.managerTimeline);

      // // Handle all possible values and only return first maches
      // collectionToReturn.collectionApprovals = getFirstMatchForCollectionApprovals(collectionToReturn.collectionApprovals.map(x => convertCollectionApprovalWithDetails(x, BigIntify)), true).map(x => convertCollectionApprovalWithDetails(x, Stringify));

      collectionToReturn.owners = collectionToReturn.owners.map(
        (balance) =>
          new BalanceDocWithDetails<bigint>({
            ...balance,
            incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balance, addressLists, balance.cosmosAddress),
            outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balance, addressLists, balance.cosmosAddress),
            userPermissions: applyAddressListsToUserPermissions(balance.userPermissions, addressLists)
          })
      );
    }

    // TODO: Parallelize this
    // Perform off-chain claims query (on-chain ones are handled below with approval fetches)
    if (collectionToReturn.balancesType !== 'Standard') {
      const docs = await findInDB(ClaimBuilderModel, {
        query: { collectionId: Number(collectionToReturn.collectionId), docClaimed: true, deletedAt: { $exists: false } }
      });

      const claims = await getClaimDetailsForFrontend(req, res, docs, query.fetchPrivateParams, {
        collectionId: collectionToReturn.collectionId,
        approverAddress: '',
        approvalLevel: 'collection',
        //Dont need these
        approvalId: '',
        challengeTrackerId: ''
      });
      collectionToReturn.claims = claims as Array<Required<ClaimDetails<bigint>>>;
    }

    const reservedMap = await getFromDB(MapModel, `${collectionToReturn.collectionId}`);
    if (reservedMap) {
      collectionToReturn.reservedMap = reservedMap;
    }

    collectionResponses.push(collectionToReturn);
  }

  // Append fetched approval details
  const pageVisitsPromises = [];

  for (let i = 0; i < collectionResponses.length; i++) {
    const collectionRes = collectionResponses[i];
    const query = collectionQueries[i];

    for (let i = 0; i < collectionRes.collectionApprovals.length; i++) {
      const approval = collectionRes.collectionApprovals[i];

      let content;

      if (approval.uri) {
        const claimFetch = claimFetchesFlat.find((fetch) => fetch.uri === approval.uri);
        if (!claimFetch?.content) continue;

        content = claimFetch.content as ApprovalInfoDetails<bigint>;
        approval.details = content;
      }

      for (const merkleChallenge of approval.approvalCriteria?.merkleChallenges ?? []) {
        const claimFetch = claimFetchesFlat.find((fetch) => fetch.uri === merkleChallenge.uri);
        if (!claimFetch?.content) continue;

        merkleChallenge.challengeInfoDetails.challengeDetails = claimFetch.content as ChallengeDetails<bigint>;
        const challengeTrackerId = merkleChallenge.challengeTrackerId;
        const docs = await findInDB(ClaimBuilderModel, {
          query: { collectionId: Number(collectionRes.collectionId), docClaimed: true, cid: challengeTrackerId, deletedAt: { $exists: false } }
        });
        if (docs.length > 0) {
          const claims = await getClaimDetailsForFrontend(req, res, docs, query.fetchPrivateParams, docs[0].trackerDetails);
          merkleChallenge.challengeInfoDetails.claim = claims[0];
        }
      }

      collectionRes.collectionApprovals[i] = approval;
    }
    collectionResponses[i] = collectionRes;

    pageVisitsPromises.push(incrementPageVisits(collectionRes.collectionId, badgeIdsFetched[i]));
  }

  await Promise.all(pageVisitsPromises);

  return collectionResponses;
}

const getDecryptedInfo = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  doc: ClaimBuilderDoc<bigint>,
  plugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  state: any,
  fetchPrivate?: boolean,
  trackerDetails?: iChallengeTrackerIdDetails<bigint>,
  listId?: string
) => {
  const decryptedPlugins = await getDecryptedPluginsAndPublicState(req, res, plugins, state, fetchPrivate, trackerDetails, listId);

  await checkIfAuthenticatedForPrivateParams(req, res, fetchPrivate, trackerDetails, listId);

  return {
    plugins: decryptedPlugins,
    seedCode: fetchPrivate ? getDecryptedActionSeedCode(doc) : undefined
  };
};

export const getClaimDetailsForFrontend = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  docs: Array<ClaimBuilderDoc<bigint>>,
  fetchPrivate?: boolean,
  trackerDetails?: iChallengeTrackerIdDetails<bigint>,
  listId?: string
) => {
  const claimDetails: Array<iClaimDetails<bigint>> = [];
  for (const doc of docs) {
    const decryptedInfo = await getDecryptedInfo(req, res, doc, doc.plugins, doc.state, fetchPrivate, trackerDetails, listId);
    const decryptedPlugins = decryptedInfo.plugins;
    const seedCode = decryptedInfo.seedCode;

    claimDetails.push({
      claimId: doc._docId,
      balancesToSet: doc.action.balancesToSet,
      plugins: decryptedPlugins,
      manualDistribution: doc.manualDistribution,
      automatic: doc.automatic,
      metadata: doc.metadata,
      seedCode
    });
  }

  return claimDetails.map((x) => new ClaimDetails(x));
};

const checkIfAuthenticatedForPrivateParams = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  includePrivateParams?: boolean,
  trackerDetails?: iChallengeTrackerIdDetails<bigint>,
  listId?: string
) => {
  if (includePrivateParams) {
    const auth = await checkIfAuthenticated(req, res, ['Read Private Claim Data']);
    if (!auth) {
      throw new Error('You must be authenticated to fetch private params');
    }

    const authDetails = await mustGetAuthDetails(req, res);

    if (!trackerDetails && !listId) {
      throw new Error('You must provide either a collectionId or listId to fetch private params');
    }

    const collectionId = trackerDetails?.collectionId;

    if (collectionId && Number(collectionId) > 0) {
      if (trackerDetails.approvalLevel === 'collection') {
        const manager = await checkIfManager(req, res, collectionId ?? 0);
        if (!manager) {
          throw new Error('You must be a manager to fetch private params');
        }
      } else {
        //check address === approver address
        if (authDetails.cosmosAddress !== trackerDetails.approverAddress) {
          throw new Error('You must be the approver to fetch private params');
        }
      }
    }

    if (listId) {
      const list = await getAddressListsFromDB([{ listId }], false);
      if (list.length === 0) {
        throw new Error('List not found');
      }

      if (list[0].createdBy !== authDetails.cosmosAddress) {
        throw new Error('You must be the owner of the list to fetch private params');
      }
    }
  }
};

export const getDecryptedPluginsAndPublicState = async (
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  plugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  state: any,
  includePrivateParams?: boolean,
  trackerDetails?: iChallengeTrackerIdDetails<bigint>,
  listId?: string
): Promise<Array<IntegrationPluginDetails<ClaimIntegrationPluginType>>> => {
  await checkIfAuthenticatedForPrivateParams(req, res, includePrivateParams, trackerDetails, listId);

  const pluginsRes = [];
  for (const x of plugins) {
    const pluginInstance = await getPlugin(x.pluginId);
    pluginsRes.push({
      pluginId: x.pluginId,
      instanceId: x.instanceId,
      publicParams: x.publicParams,
      privateParams: includePrivateParams ? pluginInstance.decryptPrivateParams(x.privateParams) : {},
      publicState: pluginInstance.getPublicState(state[x.instanceId] ?? { ...pluginInstance.defaultState }),
      privateState: includePrivateParams ? state[x.instanceId] : undefined
    });
  }

  return pluginsRes;
};

async function incrementPageVisits(collectionId: NumberType, badgeIds: Array<UintRange<bigint>>) {
  // TODO: improve this bc it could run into lots of race conditions which is why we try catch
  try {
    let currPageVisits = await getFromDB(PageVisitsModel, `${collectionId}`);
    const badgeIdsToIncrement = badgeIds;
    if (!currPageVisits) {
      currPageVisits = new PageVisitsDoc({
        _id: new mongoose.Types.ObjectId().toString(),
        _docId: `${collectionId}`,
        collectionId: BigInt(collectionId),
        lastUpdated: Date.now(),
        overallVisits: {
          allTime: 0n,
          daily: 0n,
          weekly: 0n,
          monthly: 0n,
          yearly: 0n
        },
        badgePageVisits: {
          allTime: [],
          daily: [],
          weekly: [],
          monthly: [],
          yearly: []
        }
      });
    }

    // if was last updated yesterday, reset daily
    const yesterdayMidnight = new Date();
    yesterdayMidnight.setHours(0, 0, 0, 0);
    if (currPageVisits.lastUpdated < yesterdayMidnight.getTime()) {
      currPageVisits.overallVisits.daily = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.daily = new BalanceArray();
    }

    const sundayMidnight = new Date();
    sundayMidnight.setHours(0, 0, 0, 0);
    sundayMidnight.setDate(sundayMidnight.getDate() - sundayMidnight.getDay());
    if (currPageVisits.lastUpdated < sundayMidnight.getTime()) {
      currPageVisits.overallVisits.weekly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.weekly = new BalanceArray();
    }

    const firstOfMonth = new Date();
    firstOfMonth.setHours(0, 0, 0, 0);
    firstOfMonth.setDate(1);
    if (currPageVisits.lastUpdated < firstOfMonth.getTime()) {
      currPageVisits.overallVisits.monthly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.monthly = new BalanceArray();
    }

    const firstOfYear = new Date();
    firstOfYear.setHours(0, 0, 0, 0);
    firstOfYear.setMonth(0, 1);
    if (currPageVisits.lastUpdated < firstOfYear.getTime()) {
      currPageVisits.overallVisits.yearly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.yearly = new BalanceArray();
    }

    currPageVisits.lastUpdated = Date.now();

    currPageVisits.overallVisits.allTime += 1n;
    currPageVisits.overallVisits.daily += 1n;
    currPageVisits.overallVisits.weekly += 1n;
    currPageVisits.overallVisits.monthly += 1n;
    currPageVisits.overallVisits.yearly += 1n;

    if (currPageVisits.badgePageVisits) {
      currPageVisits.badgePageVisits.allTime.addBalance({
        amount: 1n,
        badgeIds: badgeIdsToIncrement,
        ownershipTimes: UintRangeArray.FullRanges()
      });
      currPageVisits.badgePageVisits.daily.addBalance({
        amount: 1n,
        badgeIds: badgeIdsToIncrement,
        ownershipTimes: UintRangeArray.FullRanges()
      });
      currPageVisits.badgePageVisits.weekly.addBalance({
        amount: 1n,
        badgeIds: badgeIdsToIncrement,
        ownershipTimes: UintRangeArray.FullRanges()
      });
      currPageVisits.badgePageVisits.monthly.addBalance({
        amount: 1n,
        badgeIds: badgeIdsToIncrement,
        ownershipTimes: UintRangeArray.FullRanges()
      });
      currPageVisits.badgePageVisits.yearly.addBalance({
        amount: 1n,
        badgeIds: badgeIdsToIncrement,
        ownershipTimes: UintRangeArray.FullRanges()
      });
    }

    await insertToDB(PageVisitsModel, currPageVisits);
  } catch (e) {
    // bound to be write conflicts
  }
}

export async function executeCollectionsQuery(req: Request, res: Response, collectionQueries: CollectionQueryOptions[]) {
  const baseCollections = await mustGetManyFromDB(
    CollectionModel,
    collectionQueries.map((query) => `${query.collectionId.toString()}`)
  );
  const collRes = await executeAdditionalCollectionQueries(req, res, baseCollections, collectionQueries);
  return collRes;
}

export const getBadgeActivity = async (req: Request, res: Response<iGetBadgeActivitySuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetBadgeActivityPayload;
    const activityRes = await executeBadgeActivityQuery(req.params.collectionId, req.params.badgeId, reqPayload.bookmark, reqPayload.cosmosAddress);

    return res.json(activityRes);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error fetching badge activity'
    });
  }
};

export const getCollections = async (req: Request, res: Response<iGetCollectionsSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetCollectionsPayload;

    if (reqPayload.collectionsToFetch.length > 100) {
      return res.status(400).send({
        errorMessage:
          'For scalability purposes, we limit the number of collections that can be fetched at once to 250. Please design your application to fetch collections in batches of 250 or less.'
      });
    }

    const collectionResponses = await executeCollectionsQuery(req, res, reqPayload.collectionsToFetch);
    return res.status(200).send({
      collections: collectionResponses
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error fetching collections.'
    });
  }
};

const getMetadata = async (
  collectionId: NumberType,
  collectionUri: string,
  _badgeUris: Array<BadgeMetadata<bigint>>,
  fetchOptions?: MetadataFetchOptions
) => {
  const badgeUris = _badgeUris.map((x) => x.clone());
  const doNotFetchCollectionMetadata = fetchOptions?.doNotFetchCollectionMetadata;
  const urisToFetch = fetchOptions?.uris ? fetchOptions.uris : [];
  const badgeIdsToFetch = fetchOptions?.badgeIds ? fetchOptions.badgeIds : [];

  let uris: {
    onChainUri: string;
    toFetchUri: string;
  }[] = [];

  if (!doNotFetchCollectionMetadata && collectionUri) {
    uris.push({
      onChainUri: collectionUri,
      toFetchUri: collectionUri
    });
  }

  for (const uri of urisToFetch) {
    const placeholderUri = uri;
    let onChainUri = '';
    for (const badgeUri of badgeUris) {
      const hasPlaceholder = badgeUri.uri.includes('{id}');

      if (!hasPlaceholder && badgeUri.uri === placeholderUri) {
        onChainUri = badgeUri.uri;
        break;
      } else {
        const beforeIdStr = badgeUri.uri.split('{id}')[0];
        const afterIdStr = badgeUri.uri.split('{id}')[1];

        if (placeholderUri.startsWith(beforeIdStr) && placeholderUri.endsWith(afterIdStr)) {
          //Handle edge case where the placeholder is not a number
          try {
            BigInt(placeholderUri.replace(beforeIdStr, '').replace(afterIdStr, ''));
          } catch (e) {
            continue;
          }

          onChainUri = badgeUri.uri;
          break;
        }
      }
    }

    if (onChainUri) {
      uris.push({
        onChainUri: onChainUri,
        toFetchUri: uri
      });
    }
  }

  for (const badgeId of badgeIdsToFetch) {
    const badgeIdCastedAsUintRange = badgeId as UintRange<NumberType>;
    const badgeIdCastedAsNumber = badgeId as NumberType;
    let badgeIdsLeft: UintRangeArray<bigint> = new UintRangeArray<bigint>();

    if (typeof badgeId === 'object' && badgeIdCastedAsUintRange.start && badgeIdCastedAsUintRange.end) {
      badgeIdsLeft = UintRangeArray.From([badgeIdCastedAsUintRange]).convert(BigIntify);
    } else {
      badgeIdsLeft = UintRangeArray.From([{ start: badgeIdCastedAsNumber, end: badgeIdCastedAsNumber }]).convert(BigIntify);
    }

    const allBadgeIdsInMetadata = UintRangeArray.From<bigint>(badgeUris.map((x) => x.badgeIds).flat());
    allBadgeIdsInMetadata.sortAndMerge();
    const allBadgeIdsNotInMetadata = allBadgeIdsInMetadata.toInverted({ start: 1n, end: GO_MAX_UINT_64 });
    badgeIdsLeft.remove(allBadgeIdsNotInMetadata);
    badgeIdsLeft.sortAndMerge();

    //Get URIs for each badgeID
    while (badgeIdsLeft.length > 0) {
      // Intuition: Start with the first singular badgeID -> fetch its metadata ID / URI -> if it shares with other badge IDs, we mark those handled as well
      const currBadgeUintRange = badgeIdsLeft[0];
      const allMatchingBadgeUintRanges = UintRangeArray.From({ start: currBadgeUintRange.start, end: currBadgeUintRange.start });

      let handled = false;
      for (const badgeUri of badgeUris) {
        //We should always have one badge ID match in the badge metadata
        if (badgeUri.badgeIds.searchIfExists(BigInt(currBadgeUintRange.start))) {
          handled = true;

          //If it has a placeholder, we need to replace it with the badge ID and thus it only applies to this specific badge ID
          //Else, it applies to all badge IDs that correspond to the same URI
          if (badgeUri.uri.includes('{id}')) {
            uris.push({
              onChainUri: badgeUri.uri,
              toFetchUri: badgeUri.uri.replace('{id}', currBadgeUintRange.start.toString())
            });
            badgeIdsLeft.remove(allMatchingBadgeUintRanges);
            badgeIdsLeft.sortAndMerge();
          } else {
            uris.push({
              onChainUri: badgeUri.uri,
              toFetchUri: badgeUri.uri
            });
            allMatchingBadgeUintRanges.push(...UintRangeArray.From(badgeUri.badgeIds).convert(BigIntify));
            allMatchingBadgeUintRanges.sortAndMerge();
            badgeIdsLeft.remove(allMatchingBadgeUintRanges);
            badgeIdsLeft.sortAndMerge();
          }

          break; //First match only
        }
      }

      // This metadata does not contain the badge ID requested
      // This should never be the case bc we handle out of bounds badge IDs at the top of the function
      if (!handled) {
        throw new Error('Badge ID not found. Requested a badge ID not found in the badge metadata.');
      }

      badgeIdsLeft.sortAndMerge();
    }
  }

  uris = [...new Set(uris)];

  if (uris.length > 250) {
    throw new Error(
      'For scalability, we limit the number of metadata URIs that can be fetched at once to 250. Please design your application to fetch metadata in batches of 250 or less.'
    );
  }

  const results = await fetchUrisFromDbAndAddToQueueIfEmpty(
    uris.map((x) => x.toFetchUri),
    collectionId.toString()
  );

  let collectionMetadata: Metadata<bigint> | undefined;
  if (!doNotFetchCollectionMetadata) {
    //We pushed the collection URI first
    const collectionMetadataResult = results[0];
    const collectionMetadataResultContent = results[0].content as Metadata<bigint>;
    if (collectionMetadataResult) {
      collectionMetadata = new Metadata({
        ...(collectionMetadataResultContent ?? Metadata.DefaultPlaceholderMetadata()),
        _isUpdating: collectionMetadataResult.updating,
        fetchedAt: BigInt(collectionMetadataResult.fetchedAt),
        fetchedAtBlock: BigInt(collectionMetadataResult.fetchedAtBlock)
      });
    }
  }

  let badgeMetadata: Array<BadgeMetadataDetails<bigint>> = [];
  const toUpdate: Array<BadgeMetadataDetails<bigint>> = [];
  for (const { onChainUri: uri, toFetchUri: fetchedUri } of uris) {
    const placeholderReplaced = fetchedUri !== uri;

    const badgeIds = UintRangeArray.From<bigint>([]);
    for (const badgeUri of badgeUris) {
      //If on-chain URIs match, we can push the corresponding metadata and badgeIds
      if (badgeUri.uri === uri) {
        if (!placeholderReplaced) {
          badgeIds.push(...badgeUri.badgeIds);
        } else {
          //Find the badge ID that corresponds to the fetched URI (the replaced one)
          const beforeIdStr = badgeUri.uri.split('{id}')[0];
          const afterIdStr = badgeUri.uri.split('{id}')[1];

          if (fetchedUri.startsWith(beforeIdStr) && fetchedUri.endsWith(afterIdStr)) {
            const replacedId = fetchedUri.replace(beforeIdStr, '').replace(afterIdStr, '');
            try {
              BigInt(replacedId);
            } catch (e) {
              continue;
            }
            badgeIds.push({ start: BigInt(replacedId), end: BigInt(replacedId) });
          }
        }
      }
    }

    const resultIdx = uris.findIndex((x) => x.toFetchUri === fetchedUri);
    const result = results[resultIdx];
    const badgeMetadataResultContent = result.content as Metadata<bigint>;
    toUpdate.push(
      new BadgeMetadataDetails({
        uri,
        fetchedUri,
        badgeIds,
        customData: '',
        metadata: new Metadata({
          ...(badgeMetadataResultContent ?? Metadata.DefaultPlaceholderMetadata()),
          _isUpdating: result.updating,
          fetchedAt: BigInt(result.fetchedAt),
          fetchedAtBlock: BigInt(result.fetchedAtBlock)
        })
      })
    );
  }

  badgeMetadata = batchUpdateBadgeMetadata(badgeMetadata, toUpdate);

  return {
    collectionMetadata: new CollectionMetadataDetails({
      uri: collectionUri,
      fetchedUri: collectionUri,
      customData: '',
      metadata: collectionMetadata
        ? new Metadata({
            ...collectionMetadata?.clone()
          })
        : undefined
    }),
    badgeMetadata: badgeMetadata.map((x) => x.clone())
  };
};

const appendMetadataResToCollection = (
  metadataRes: {
    collectionMetadata?: CollectionMetadataDetails<bigint>;
    badgeMetadata?: Array<BadgeMetadataDetails<bigint>>;
  },
  collection: BitBadgesCollection<bigint> | BitBadgesCollection<bigint>
) => {
  let cachedBadgeMetadata = collection.getCurrentBadgeMetadata();
  if (metadataRes.badgeMetadata) {
    cachedBadgeMetadata = batchUpdateBadgeMetadata(cachedBadgeMetadata, metadataRes.badgeMetadata);
  }

  if (metadataRes.collectionMetadata) {
    for (const timelineTime of collection.collectionMetadataTimeline) {
      if (timelineTime.timelineTimes.searchIfExists(BigInt(Date.now()))) {
        timelineTime.collectionMetadata = metadataRes.collectionMetadata;
      }
    }
  }

  for (const timelineTime of collection.badgeMetadataTimeline) {
    if (timelineTime.timelineTimes.searchIfExists(BigInt(Date.now()))) {
      timelineTime.badgeMetadata = cachedBadgeMetadata;
    }
  }

  return collection;
};
