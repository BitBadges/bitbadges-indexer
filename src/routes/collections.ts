import { AddressList, BadgeMetadata, JSPrimitiveNumberType, NumberType, UintRange, convertAmountTrackerIdDetails, convertBadgeMetadata, convertBadgeMetadataTimeline, convertCollectionMetadataTimeline, convertCustomDataTimeline, convertIsArchivedTimeline, convertManagerTimeline, convertOffChainBalancesMetadataTimeline, convertStandardsTimeline, convertUintRange } from "bitbadgesjs-sdk";
import {
  ApprovalInfoDetails, ApprovalTrackerDoc, BadgeMetadataDetails, BalanceDoc, BalanceDocWithDetails, BigIntify, BitBadgesCollection,
  CollectionDoc, DefaultPlaceholderMetadata, GetAdditionalCollectionDetailsRequestBody, GetBadgeActivityRouteRequestBody,
  GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody,
  GetCollectionRouteResponse, GetMetadataForCollectionRequestBody, MerkleChallengeDoc, Metadata, MetadataFetchOptions, PaginationInfo, ReviewDoc, Stringify, TransferActivityDoc, addBalance, batchUpdateBadgeMetadata, convertApprovalInfoDetails, convertApprovalTrackerDoc, convertBadgeMetadataDetails, convertBitBadgesCollection,
  convertComplianceDoc, convertMerkleChallengeDoc, convertMetadata, convertReviewDoc, convertTransferActivityDoc, getBadgeIdsForMetadataId, getCurrentValueForTimeline, getFullBadgeMetadataTimeline, getFullCollectionMetadataTimeline, getFullCustomDataTimeline, getFullIsArchivedTimeline, getFullManagerTimeline, getFullStandardsTimeline, getMetadataIdForBadgeId, getMetadataIdsForUri, getOffChainBalancesMetadataTimeline, getUrisForMetadataIds, removeUintRangesFromUintRanges, sortUintRangesAndMergeIfNecessary
} from "bitbadgesjs-sdk";
import { Request, Response } from "express";
import mongoose from "mongoose";
import { serializeError } from "serialize-error";
import { CollectionModel, PageVisitsModel, convertPageVisitsDoc, getFromDB, insertToDB, mustGetManyFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { fetchUrisFromDbAndAddToQueueIfEmpty } from "../queue";
import { executeApprovalTrackersByIdsQuery, executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionApprovalTrackersQuery, executeCollectionBalancesQuery, executeCollectionMerkleChallengesQuery, executeCollectionReviewsQuery, executeMerkleChallengeByIdsQuery, fetchTotalAndUnmintedBalancesQuery } from "./activityHelpers";
import { applyAddressListsToUserPermissions } from "./balances";
import { appendSelfInitiatedIncomingApprovalToApprovals, appendSelfInitiatedOutgoingApprovalToApprovals, getAddressListsFromDB } from "./utils";

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
export type CollectionQueryOptions = ({ collectionId: NumberType } & GetMetadataForCollectionRequestBody & GetAdditionalCollectionDetailsRequestBody);

export async function executeAdditionalCollectionQueries(req: Request, baseCollections: CollectionDoc<JSPrimitiveNumberType>[], collectionQueries: CollectionQueryOptions[]) {
  const promises = [];
  const collectionResponses: BitBadgesCollection<JSPrimitiveNumberType>[] = [];

  const balanceResIdxs = [];
  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    const collectionUri = getCurrentValueForTimeline(collection.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify)))?.collectionMetadata.uri ?? '';
    const badgeMetadata = getCurrentValueForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)))?.badgeMetadata ?? [];

    promises.push(getMetadata(collection.collectionId.toString(), collectionUri, badgeMetadata, query.metadataToFetch));

    for (const view of query.viewsToFetch ?? []) {
      const bookmark = view.bookmark;
      const oldestFirst = view.oldestFirst;
      if (view.viewType === 'transferActivity') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionActivityQuery(`${query.collectionId}`, bookmark, oldestFirst));
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
      } else if (view.viewType === 'merkleChallenges') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionMerkleChallengesQuery(`${query.collectionId}`, bookmark, oldestFirst));
        }
      } else if (view.viewType === 'approvalTrackers') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionApprovalTrackersQuery(`${query.collectionId}`, bookmark, oldestFirst));
        }
      }
    }

    if (query.challengeTrackersToFetch?.length) {
      promises.push(executeMerkleChallengeByIdsQuery(`${query.collectionId}`, query.challengeTrackersToFetch));
    }

    if (query.approvalTrackersToFetch?.length) {
      promises.push(executeApprovalTrackersByIdsQuery(`${query.collectionId}`, query.approvalTrackersToFetch.map(x => convertAmountTrackerIdDetails(x, BigIntify))));
    }

    if (query.fetchTotalAndMintBalances) {
      promises.push(fetchTotalAndUnmintedBalancesQuery(`${query.collectionId}`));
      balanceResIdxs.push(promises.length - 1);
    }
  }

  //Parse results and add to collectionResponses
  const responses = await Promise.all(promises);

  const addressListIdsToFetch: { collectionId: NumberType, listId: string }[] = [];
  let currPromiseIdx = 0;
  for (const query of collectionQueries) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collectionRes) continue;

    for (const collectionApprovalVal of collectionRes.collectionApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: collectionApprovalVal.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: collectionApprovalVal.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: collectionApprovalVal.initiatedByListId
      });
    }

    for (const incomingPermission of collectionRes.defaultBalances.userPermissions.canUpdateIncomingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: incomingPermission.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: incomingPermission.initiatedByListId
      });
    }

    for (const outgoingPermission of collectionRes.defaultBalances.userPermissions.canUpdateOutgoingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: outgoingPermission.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: outgoingPermission.initiatedByListId
      });
    }


    for (const permission of collectionRes.collectionPermissions.canUpdateCollectionApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: permission.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: permission.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: permission.initiatedByListId
      });
    }

    for (const transfer of collectionRes.defaultBalances.incomingApprovals) {

      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: transfer.fromListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: transfer.initiatedByListId
      });

    }

    for (const transfer of collectionRes.defaultBalances.outgoingApprovals) {
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: transfer.toListId
      });
      addressListIdsToFetch.push({
        collectionId: collectionRes.collectionId, listId: transfer.initiatedByListId
      });
    }

    for (const idx of balanceResIdxs) {
      const balanceRes = responses[idx] as { docs: BalanceDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
      for (const balanceDoc of balanceRes.docs) {
        for (const transfer of balanceDoc.incomingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId, listId: transfer.fromListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId, listId: transfer.initiatedByListId
          });

        }

        for (const transfer of balanceDoc.outgoingApprovals) {
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId, listId: transfer.toListId
          });
          addressListIdsToFetch.push({
            collectionId: collectionRes.collectionId, listId: transfer.initiatedByListId
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

    if (urisToFetch.length) {
      claimFetchesPromises.push(fetchUrisFromDbAndAddToQueueIfEmpty(
        [...new Set(urisToFetch)].filter(x => x),
        collectionId.toString())
      );
    }
  }

  const addressListsPromise = getAddressListsFromDB(addressListIdsToFetch, false);

  const [addressLists, claimFetches] = await Promise.all([
    addressListsPromise,
    Promise.all(claimFetchesPromises)
  ]);

  const badgeIdsFetched: UintRange<JSPrimitiveNumberType>[][] = [];
  for (const query of collectionQueries) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collectionRes) continue;

    const _complianceDoc = complianceDoc ? convertComplianceDoc(complianceDoc, Stringify) : undefined;
    const isNSFW = _complianceDoc?.badges?.nsfw?.find(x => BigInt(x.collectionId) === BigInt(collectionRes.collectionId));
    const isReported = _complianceDoc?.badges?.reported?.find(x => BigInt(x.collectionId) === BigInt(collectionRes.collectionId));

    let collectionToReturn: BitBadgesCollection<JSPrimitiveNumberType> = {
      ...collectionRes,
      nsfw: isNSFW,
      reported: isReported,
      collectionApprovals: collectionRes.collectionApprovals.map(x => {
        return {
          ...x,
          fromList: addressLists.find((list) => list.listId === x.fromListId) as AddressList,
          toList: addressLists.find((list) => list.listId === x.toListId) as AddressList,
          initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as AddressList,
        }
      }),
      defaultBalances: {
        ...collectionRes.defaultBalances,
        outgoingApprovals: collectionRes.defaultBalances.outgoingApprovals.map(x => {
          return {
            ...x,
            toList: addressLists.find((list) => list.listId === x.toListId) as AddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as AddressList,
          }
        }),
        incomingApprovals: collectionRes.defaultBalances.incomingApprovals.map(x => {
          return {
            ...x,
            fromList: addressLists.find((list) => list.listId === x.fromListId) as AddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as AddressList,
          }
        }),
        userPermissions: applyAddressListsToUserPermissions(collectionRes.defaultBalances.userPermissions, addressLists),
      },


      collectionPermissions: {
        ...collectionRes.collectionPermissions,
        canUpdateCollectionApprovals: collectionRes.collectionPermissions.canUpdateCollectionApprovals.map(x => {
          return {
            ...x,
            fromList: addressLists.find((list) => list.listId === x.fromListId) as AddressList,
            toList: addressLists.find((list) => list.listId === x.toListId) as AddressList,
            initiatedByList: addressLists.find((list) => list.listId === x.initiatedByListId) as AddressList,
          }
        })
      },

      //Placeholders to be replaced later in function
      activity: [],
      announcements: [],
      reviews: [],
      owners: [],
      merkleChallenges: [],
      approvalTrackers: [],

      cachedBadgeMetadata: [],
      views: {},
    };


    const metadataRes = responses[currPromiseIdx++] as { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: BadgeMetadataDetails<JSPrimitiveNumberType>[] };
    badgeIdsFetched.push(metadataRes.badgeMetadata.map(x => x.badgeIds).flat());
    const getBalanceDocsWithDetails = (docs: BalanceDoc<JSPrimitiveNumberType>[]) => {
      return docs.map((doc) => {
        return {
          ...doc,
          incomingApprovals: doc.incomingApprovals.map(x => {
            return {
              ...x,
              fromList: addressLists.find(z => z.listId === x.fromListId) as AddressList,
              initiatedByList: addressLists.find(z => z.listId === x.initiatedByListId) as AddressList,
            }
          }),
          outgoingApprovals: doc.outgoingApprovals.map(x => {
            return {
              ...x,
              toList: addressLists.find(z => z.listId === x.toListId) as AddressList,
              initiatedByList: addressLists.find(z => z.listId === x.initiatedByListId) as AddressList,
            }
          })
        }
      }) as BalanceDocWithDetails<JSPrimitiveNumberType>[];
    }

    if (query.viewsToFetch?.length) {
      for (let j = 0; j < (query.viewsToFetch ?? [])?.length; j++) {
        const view = query.viewsToFetch[j];
        const genericViewRes = responses[currPromiseIdx] as { docs: any[], pagination: PaginationInfo };
        let type = 'Activity';
        if (view.viewType === 'transferActivity') {
          const viewRes = responses[currPromiseIdx++] as { docs: TransferActivityDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.activity.push(...viewRes.docs.map(x => convertTransferActivityDoc(x, Stringify)));
          type = 'Activity';
        }
        // else if (view.viewType === 'latestAnnouncements') {
        //   const viewRes = responses[currPromiseIdx++] as { docs: any[], pagination: PaginationInfo };
        //   collectionToReturn.announcements.push(...viewRes.docs.map(x => convertAnnouncementDoc(x, Stringify)));
        //   type = 'Announcement';
        // } 
        else if (view.viewType === 'reviews') {
          const viewRes = responses[currPromiseIdx++] as { docs: ReviewDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.reviews.push(...viewRes.docs.map(x => convertReviewDoc(x, Stringify)));
          type = 'Review';
        } else if (view.viewType === 'owners') {
          const viewRes = responses[currPromiseIdx++] as { docs: BalanceDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.owners.push(...getBalanceDocsWithDetails(viewRes.docs));
          type = 'Balance';
        } else if (view.viewType === 'merkleChallenges') {
          const viewRes = responses[currPromiseIdx++] as { docs: MerkleChallengeDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.merkleChallenges.push(...viewRes.docs.map(x => convertMerkleChallengeDoc(x, Stringify)));
          type = 'MerkleChallenge';
        } else if (view.viewType === 'approvalTrackers') {
          const viewRes = responses[currPromiseIdx++] as { docs: ApprovalTrackerDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.approvalTrackers.push(...viewRes.docs.map(x => convertApprovalTrackerDoc(x, Stringify)));
          type = 'ApprovalTracker';
        }

        collectionToReturn.views[view.viewId] = {
          ids: genericViewRes.docs.map((doc) => doc._docId),
          type: type,
          pagination: {
            bookmark: genericViewRes.pagination.bookmark || '',
            hasMore: genericViewRes.docs.length === 25
          }
        }
      }
    }

    if (query.challengeTrackersToFetch?.length) {
      const merkleChallengeRes = responses[currPromiseIdx++] as (MerkleChallengeDoc<JSPrimitiveNumberType>)[];
      collectionToReturn.merkleChallenges.push(...merkleChallengeRes.map(x => convertMerkleChallengeDoc(x, Stringify)));
    }

    if (query.approvalTrackersToFetch?.length) {
      const approvalTrackerRes = responses[currPromiseIdx++] as (ApprovalTrackerDoc<JSPrimitiveNumberType>)[];
      collectionToReturn.approvalTrackers.push(...approvalTrackerRes.map(x => convertApprovalTrackerDoc(x, Stringify)));
    }

    if (query.fetchTotalAndMintBalances) {
      const mintAndTotalBalancesRes = responses[currPromiseIdx++] as { docs: BalanceDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
      collectionToReturn.owners.push(...getBalanceDocsWithDetails(mintAndTotalBalancesRes.docs));
    }

    //Remove duplicates
    collectionToReturn.activity = collectionToReturn.activity.filter((activity, index, self) => self.findIndex((t) => t._docId === activity._docId) === index);
    collectionToReturn.announcements = collectionToReturn.announcements.filter((announcement, index, self) => self.findIndex((t) => t._docId === announcement._docId) === index);
    collectionToReturn.reviews = collectionToReturn.reviews.filter((review, index, self) => self.findIndex((t) => t._docId === review._docId) === index);
    collectionToReturn.owners = collectionToReturn.owners.filter((owner, index, self) => self.findIndex((t) => t._docId === owner._docId) === index);
    collectionToReturn.merkleChallenges = collectionToReturn.merkleChallenges.filter((merkleChallenge, index, self) => self.findIndex((t) => t._docId === merkleChallenge._docId) === index);
    collectionToReturn.approvalTrackers = collectionToReturn.approvalTrackers.filter((approvalTracker, index, self) => self.findIndex((t) => t._docId === approvalTracker._docId) === index);


    const appendedCollection = appendMetadataResToCollection(metadataRes, collectionToReturn);
    collectionToReturn.cachedBadgeMetadata = appendedCollection.cachedBadgeMetadata;
    collectionToReturn.cachedCollectionMetadata = appendedCollection.cachedCollectionMetadata;
    if (query.handleAllAndAppendDefaults) {
      //Convert all timelines to handle all possible timeline time values
      collectionToReturn.collectionMetadataTimeline = getFullCollectionMetadataTimeline(collectionToReturn.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify))).map(x => convertCollectionMetadataTimeline(x, Stringify));

      collectionToReturn.badgeMetadataTimeline = getFullBadgeMetadataTimeline(
        collectionToReturn.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify))
      ).map(x => convertBadgeMetadataTimeline(x, Stringify));
      collectionToReturn.isArchivedTimeline = getFullIsArchivedTimeline(
        collectionToReturn.isArchivedTimeline.map(x => convertIsArchivedTimeline(x, BigIntify))
      ).map(x => convertIsArchivedTimeline(x, Stringify));
      collectionToReturn.offChainBalancesMetadataTimeline = getOffChainBalancesMetadataTimeline(
        collectionToReturn.offChainBalancesMetadataTimeline.map(x => convertOffChainBalancesMetadataTimeline(x, BigIntify))
      ).map(x => convertOffChainBalancesMetadataTimeline(x, Stringify));
      collectionToReturn.customDataTimeline = getFullCustomDataTimeline(
        collectionToReturn.customDataTimeline.map(x => convertCustomDataTimeline(x, BigIntify))
      ).map(x => convertCustomDataTimeline(x, Stringify));
      collectionToReturn.standardsTimeline = getFullStandardsTimeline(
        collectionToReturn.standardsTimeline.map(x => convertStandardsTimeline(x, BigIntify))
      ).map(x => convertStandardsTimeline(x, Stringify));
      collectionToReturn.managerTimeline = getFullManagerTimeline(
        collectionToReturn.managerTimeline.map(x => convertManagerTimeline(x, BigIntify))
      ).map(x => convertManagerTimeline(x, Stringify));

      //Handle all possible values and only return first maches
      // collectionToReturn.collectionApprovals = getFirstMatchForCollectionApprovals(collectionToReturn.collectionApprovals.map(x => convertCollectionApprovalWithDetails(x, BigIntify)), true).map(x => convertCollectionApprovalWithDetails(x, Stringify));

      collectionToReturn.owners = collectionToReturn.owners.map((balance) => {
        return {
          ...balance,
          incomingApprovals: appendSelfInitiatedIncomingApprovalToApprovals(balance, addressLists, balance.cosmosAddress),
          outgoingApprovals: appendSelfInitiatedOutgoingApprovalToApprovals(balance, addressLists, balance.cosmosAddress)
        }
      });


    }

    collectionResponses.push(convertBitBadgesCollection(collectionToReturn, Stringify));
  }

  //Append fetched approval details
  const pageVisitsPromises = [];
  const claimFetchesFlat = claimFetches.flat();
  for (let i = 0; i < collectionResponses.length; i++) {
    const collectionRes = collectionResponses[i];

    for (let i = 0; i < collectionRes.collectionApprovals.length; i++) {
      const approval = collectionRes.collectionApprovals[i];
      if (approval.uri) {
        const claimFetch = claimFetchesFlat.find((fetch) => fetch.uri === approval.uri);
        if (!claimFetch || !claimFetch.content) continue;

        approval.details = convertApprovalInfoDetails(claimFetch.content as ApprovalInfoDetails<JSPrimitiveNumberType>, Stringify);
        if (approval.approvalCriteria?.merkleChallenge?.uri) {
          approval.approvalCriteria.merkleChallenge.details = convertApprovalInfoDetails(claimFetch.content as ApprovalInfoDetails<JSPrimitiveNumberType>, Stringify);
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

async function incrementPageVisits(collectionId: NumberType, badgeIds: UintRange<JSPrimitiveNumberType>[]) {
  //TODO: improve this bc it could run into lots of race conditions which is why we try catch
  try {
    let _currPageVisits = await getFromDB(PageVisitsModel, `${collectionId}`);
    let currPageVisits = _currPageVisits ? convertPageVisitsDoc(_currPageVisits, BigIntify) : undefined
    const badgeIdsToIncrement = badgeIds;
    if (!currPageVisits) {
      currPageVisits = {
        _id: new mongoose.Types.ObjectId().toString(),
        _docId: `${collectionId}`,
        collectionId: BigInt(collectionId),
        lastUpdated: Date.now(),
        overallVisits: {
          allTime: 0n,
          daily: 0n,
          weekly: 0n,
          monthly: 0n,
          yearly: 0n,
        },
        badgePageVisits: {
          allTime: [],
          daily: [],
          weekly: [],
          monthly: [],
          yearly: [],
        },
      }
    }

    //if was last updated yesterday, reset daily
    const yesterdayMidnight = new Date();
    yesterdayMidnight.setHours(0, 0, 0, 0);
    if (currPageVisits.lastUpdated < yesterdayMidnight.getTime()) {
      currPageVisits.overallVisits.daily = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.daily = [];
    }

    const sundayMidnight = new Date();
    sundayMidnight.setHours(0, 0, 0, 0);
    sundayMidnight.setDate(sundayMidnight.getDate() - sundayMidnight.getDay());
    if (currPageVisits.lastUpdated < sundayMidnight.getTime()) {
      currPageVisits.overallVisits.weekly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.weekly = [];
    }

    const firstOfMonth = new Date();
    firstOfMonth.setHours(0, 0, 0, 0);
    firstOfMonth.setDate(1);
    if (currPageVisits.lastUpdated < firstOfMonth.getTime()) {
      currPageVisits.overallVisits.monthly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.monthly = [];
    }

    const firstOfYear = new Date();
    firstOfYear.setHours(0, 0, 0, 0);
    firstOfYear.setMonth(0, 1);
    if (currPageVisits.lastUpdated < firstOfYear.getTime()) {
      currPageVisits.overallVisits.yearly = 0n;
      if (currPageVisits.badgePageVisits) currPageVisits.badgePageVisits.yearly = [];
    }

    currPageVisits.lastUpdated = Date.now();

    currPageVisits.overallVisits.allTime += 1n;
    currPageVisits.overallVisits.daily += 1n;
    currPageVisits.overallVisits.weekly += 1n;
    currPageVisits.overallVisits.monthly += 1n;
    currPageVisits.overallVisits.yearly += 1n;

    if (currPageVisits.badgePageVisits) {
      currPageVisits.badgePageVisits.allTime = addBalance(currPageVisits.badgePageVisits.allTime, { amount: 1n, badgeIds: badgeIdsToIncrement.map(x => convertUintRange(x, BigIntify)), ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }] });
      currPageVisits.badgePageVisits.daily = addBalance(currPageVisits.badgePageVisits.daily, { amount: 1n, badgeIds: badgeIdsToIncrement.map(x => convertUintRange(x, BigIntify)), ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }] });
      currPageVisits.badgePageVisits.weekly = addBalance(currPageVisits.badgePageVisits.weekly, { amount: 1n, badgeIds: badgeIdsToIncrement.map(x => convertUintRange(x, BigIntify)), ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }] });
      currPageVisits.badgePageVisits.monthly = addBalance(currPageVisits.badgePageVisits.monthly, { amount: 1n, badgeIds: badgeIdsToIncrement.map(x => convertUintRange(x, BigIntify)), ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }] });
      currPageVisits.badgePageVisits.yearly = addBalance(currPageVisits.badgePageVisits.yearly, { amount: 1n, badgeIds: badgeIdsToIncrement.map(x => convertUintRange(x, BigIntify)), ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }] });
    }


    await insertToDB(PageVisitsModel, convertPageVisitsDoc(currPageVisits, BigIntify));
  } catch (e) {
    //bound to be write conflicts
  }
}

export async function executeCollectionsQuery(req: Request, collectionQueries: CollectionQueryOptions[]) {
  const baseCollections = await mustGetManyFromDB(CollectionModel, collectionQueries.map((query) => `${query.collectionId.toString()}`));
  const res = await executeAdditionalCollectionQueries(req, baseCollections, collectionQueries);
  return res;
}

export const getCollectionById = async (req: Request, res: Response<GetCollectionRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetCollectionByIdRouteRequestBody;

    const collectionsReponse = await executeCollectionsQuery(req, [{
      collectionId: BigInt(req.params.collectionId),
      metadataToFetch: reqBody.metadataToFetch,
      viewsToFetch: reqBody.viewsToFetch,
    }]);

    return res.json({
      collection: collectionsReponse[0],
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching collection. Please try again later.'
    });
  }
}

export const getBadgeActivity = async (req: Request, res: Response<GetBadgeActivityRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetBadgeActivityRouteRequestBody;
    const activityRes = await executeBadgeActivityQuery(req.params.collectionId, req.params.badgeId, reqBody.bookmark);

    return res.json(activityRes);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching badge activity'
    });
  }
}

export const getCollections = async (req: Request, res: Response<GetCollectionBatchRouteResponse<NumberType>>) => {
  try {
    if (req.body.collectionsToFetch.length > 100) {
      return res.status(400).send({
        errorMessage: 'For scalability purposes, we limit the number of collections that can be fetched at once to 250. Please design your application to fetch collections in batches of 250 or less.'
      });
    }

    const reqBody = req.body as GetCollectionBatchRouteRequestBody;
    const collectionResponses = await executeCollectionsQuery(req, reqBody.collectionsToFetch);

    return res.status(200).send({
      collections: collectionResponses
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching collections. Please try again later.'
    })
  }
}



const getMetadata = async (collectionId: NumberType, collectionUri: string, _badgeUris: BadgeMetadata<NumberType>[], fetchOptions?: MetadataFetchOptions) => {
  const badgeUris = _badgeUris.map((uri) => convertBadgeMetadata(uri, BigIntify));

  const doNotFetchCollectionMetadata = fetchOptions?.doNotFetchCollectionMetadata;
  const metadataIds = fetchOptions?.metadataIds ? fetchOptions.metadataIds : [];
  const urisToFetch = fetchOptions?.uris ? fetchOptions.uris : [];
  const badgeIdsToFetch = fetchOptions?.badgeIds ? fetchOptions.badgeIds : [];

  let uris: string[] = [];
  let metadataIdsToFetch: NumberType[] = [];

  if (!doNotFetchCollectionMetadata && collectionUri) uris.push(collectionUri);
  for (const uri of urisToFetch) {
    uris.push(uri);
    metadataIdsToFetch.push(...getMetadataIdsForUri(uri, badgeUris));
  }

  for (const metadataId of metadataIds) {
    const metadataIdCastedAsUintRange = metadataId as UintRange<NumberType>;
    const metadataIdCastedAsNumber = metadataId as NumberType;
    if (typeof metadataId === 'object' && metadataIdCastedAsUintRange.start && metadataIdCastedAsUintRange.end) {
      const start = BigInt(metadataIdCastedAsUintRange.start);
      const end = BigInt(metadataIdCastedAsUintRange.end);
      for (let i = start; i <= end; i++) {
        metadataIdsToFetch.push(i);
        uris.push(...getUrisForMetadataIds([BigInt(i)], collectionUri, badgeUris));
      }
    } else {
      metadataIdsToFetch.push(metadataIdCastedAsNumber);
      uris.push(...getUrisForMetadataIds([BigInt(metadataIdCastedAsNumber)], collectionUri, badgeUris));
    }
  }

  for (const badgeId of badgeIdsToFetch) {
    const badgeIdCastedAsUintRange = badgeId as UintRange<NumberType>;
    const badgeIdCastedAsNumber = badgeId as NumberType;
    if (typeof badgeId === 'object' && badgeIdCastedAsUintRange.start && badgeIdCastedAsUintRange.end) {
      let badgeIdsLeft = [convertUintRange(badgeIdCastedAsUintRange, BigIntify)]

      //Get URIs for each badgeID
      while (badgeIdsLeft.length > 0) {
        //Intuition: Start with the first singular badgeID -> fetch its metadata ID / URI -> if it shares with other badge IDs, we mark those handled as well

        const currBadgeUintRange = badgeIdsLeft[0];

        const metadataId = getMetadataIdForBadgeId(BigInt(currBadgeUintRange.start), badgeUris);
        if (metadataId === -1) break;

        metadataIdsToFetch.push(metadataId);
        uris.push(...getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris));

        const otherMatchingBadgeUintRanges = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
        const [remaining,] = removeUintRangesFromUintRanges(otherMatchingBadgeUintRanges, badgeIdsLeft);
        badgeIdsLeft = sortUintRangesAndMergeIfNecessary(remaining, true);

      }
    } else {
      const metadataId = getMetadataIdForBadgeId(BigInt(badgeIdCastedAsNumber), badgeUris);
      if (metadataId === -1) break;

      uris.push(...getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris));
      metadataIdsToFetch.push(metadataId);
    }
  }

  uris = [...new Set(uris)];
  metadataIdsToFetch = metadataIdsToFetch.map((id) => BigInt(id));
  metadataIdsToFetch = [...new Set(metadataIdsToFetch)];

  if (uris.length > 250) {
    throw new Error('For scalability, we limit the number of metadata URIs that can be fetched at once to 250. Please design your application to fetch metadata in batches of 250 or less.');
  }

  const results = await fetchUrisFromDbAndAddToQueueIfEmpty(uris, collectionId.toString());

  let collectionMetadata: Metadata<bigint> | undefined = undefined;
  if (!doNotFetchCollectionMetadata) {
    const collectionMetadataResult = results[0];
    if (collectionMetadataResult) {
      collectionMetadata = {
        ...convertMetadata(collectionMetadataResult.content ?? DefaultPlaceholderMetadata, BigIntify),
        _isUpdating: collectionMetadataResult.updating,
        fetchedAt: BigInt(collectionMetadataResult.fetchedAt),
        fetchedAtBlock: BigInt(collectionMetadataResult.fetchedAtBlock)
      }
    }
  }

  let badgeMetadata: BadgeMetadataDetails<bigint>[] = [];
  const toUpdate = [];
  for (const metadataId of metadataIdsToFetch) {
    const uri = getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris)[0];
    const badgeIds = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
    const resultIdx = uris.indexOf(uri);
    toUpdate.push({
      metadataId: BigInt(metadataId),
      uri,
      badgeIds,
      metadata: {
        ...convertMetadata(results[resultIdx].content ?? DefaultPlaceholderMetadata, BigIntify),
        _isUpdating: results[resultIdx].updating,
        fetchedAt: BigInt(results[resultIdx].fetchedAt),
        fetchedAtBlock: BigInt(results[resultIdx].fetchedAtBlock)
      }
    });
  }
  badgeMetadata = batchUpdateBadgeMetadata(badgeMetadata, toUpdate);

  return {
    collectionMetadata: collectionMetadata ? convertMetadata(collectionMetadata, Stringify) : undefined,
    badgeMetadata: badgeMetadata ? badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify)) : undefined
  }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata?: Metadata<JSPrimitiveNumberType>, badgeMetadata?: BadgeMetadataDetails<JSPrimitiveNumberType>[] }, collection: BitBadgesCollection<JSPrimitiveNumberType> | BitBadgesCollection<JSPrimitiveNumberType>) => {
  // Kinda hacky and inefficient, but metadataRes is the newest metadata, so we just overwrite existing metadata, if exists with same key
  const isCollectionMetadataResEmpty = !metadataRes.collectionMetadata || Object.keys(metadataRes.collectionMetadata).length === 0;
  collection.cachedCollectionMetadata = !isCollectionMetadataResEmpty ? metadataRes.collectionMetadata : collection.cachedCollectionMetadata;
  if (metadataRes.badgeMetadata) {
    let _badgeMetadata = collection.cachedBadgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, BigIntify));
    _badgeMetadata = batchUpdateBadgeMetadata(_badgeMetadata, metadataRes.badgeMetadata.map((x) => convertBadgeMetadataDetails(x, BigIntify)));
    collection.cachedBadgeMetadata = _badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify));
  }

  return collection;
}
