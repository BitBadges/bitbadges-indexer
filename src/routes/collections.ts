import { AddressMapping, BadgeMetadata, JSPrimitiveNumberType, NumberType, UintRange, convertAmountTrackerIdDetails, convertBadgeMetadata, convertBadgeMetadataTimeline, convertCollectionMetadataTimeline, convertCustomDataTimeline, convertIsArchivedTimeline, convertManagerTimeline, convertOffChainBalancesMetadataTimeline, convertStandardsTimeline, convertUintRange } from "bitbadgesjs-proto";
import { ApprovalInfoDetails, ApprovalsTrackerDoc, BadgeMetadataDetails, BalanceDoc, BalanceDocWithDetails, BigIntify, BitBadgesCollection, CollectionDoc, DefaultPlaceholderMetadata, GetAdditionalCollectionDetailsRequestBody, GetBadgeActivityRouteRequestBody, GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody, GetCollectionRouteResponse, GetMetadataForCollectionRequestBody, GetMetadataForCollectionRouteRequestBody, GetMetadataForCollectionRouteResponse, MerkleChallengeDoc, Metadata, MetadataFetchOptions, PaginationInfo, ReviewDoc, Stringify, TransferActivityDoc, addBalance, batchUpdateBadgeMetadata, convertAnnouncementDoc, convertApprovalInfoDetails, convertApprovalsTrackerDoc, convertBadgeMetadataDetails, convertBitBadgesCollection, convertCollectionDoc, convertComplianceDoc, convertMerkleChallengeDoc, convertMetadata, convertReviewDoc, convertTransferActivityDoc, getBadgeIdsForMetadataId, getCurrentValueForTimeline, getFullBadgeMetadataTimeline, getFullCollectionMetadataTimeline, getFullCustomDataTimeline, getFullIsArchivedTimeline, getFullManagerTimeline, getFullStandardsTimeline, getMetadataIdForBadgeId, getMetadataIdsForUri, getOffChainBalancesMetadataTimeline, getUrisForMetadataIds, removeUintRangeFromUintRange, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { CollectionModel, PageVisitsModel, convertPageVisitsDoc, getFromDB, insertToDB, mustGetFromDB, mustGetManyFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { fetchUriFromDbAndAddToQueueIfEmpty } from "../queue";
import { executeApprovalsTrackersByIdsQuery, executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionApprovalsTrackersQuery, executeCollectionBalancesQuery, executeCollectionMerkleChallengesQuery, executeCollectionReviewsQuery, executeMerkleChallengeByIdsQuery, fetchTotalAndUnmintedBalancesQuery } from "./activityHelpers";
import { applyAddressMappingsToUserPermissions } from "./balances";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";
import mongoose from "mongoose";

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
type CollectionQueryOptions = ({ collectionId: NumberType } & GetMetadataForCollectionRequestBody & GetAdditionalCollectionDetailsRequestBody);

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
      if (view.viewType === 'latestActivity') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionActivityQuery(`${query.collectionId}`, bookmark));
        }
      } else if (view.viewType === 'latestAnnouncements') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionAnnouncementsQuery(`${query.collectionId}`, bookmark));
        }
      } else if (view.viewType === 'latestReviews') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionReviewsQuery(`${query.collectionId}`, bookmark));
        }
      } else if (view.viewType === 'owners') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionBalancesQuery(`${query.collectionId}`, bookmark));
          balanceResIdxs.push(promises.length - 1);
        }
      } else if (view.viewType === 'merkleChallenges') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionMerkleChallengesQuery(`${query.collectionId}`, bookmark));
        }
      } else if (view.viewType === 'approvalsTrackers') {
        if (bookmark !== undefined) {
          promises.push(executeCollectionApprovalsTrackersQuery(`${query.collectionId}`, bookmark));
        }
      }
    }

    if (query.merkleChallengeIdsToFetch?.length) {
      promises.push(executeMerkleChallengeByIdsQuery(`${query.collectionId}`, query.merkleChallengeIdsToFetch));
    }

    if (query.approvalsTrackerIdsToFetch?.length) {
      promises.push(executeApprovalsTrackersByIdsQuery(`${query.collectionId}`, query.approvalsTrackerIdsToFetch.map(x => convertAmountTrackerIdDetails(x, BigIntify))));
    }

    if (query.fetchTotalAndMintBalances) {
      promises.push(fetchTotalAndUnmintedBalancesQuery(`${query.collectionId}`));
      balanceResIdxs.push(promises.length - 1);
    }
  }

  //Parse results and add to collectionResponses
  const responses = await Promise.all(promises);

  const addressMappingIdsToFetch: { collectionId: NumberType, mappingId: string }[] = [];
  let currPromiseIdx = 0;
  for (const query of collectionQueries) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collectionRes) continue;

    for (const collectionApprovalVal of collectionRes.collectionApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: collectionApprovalVal.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: collectionApprovalVal.toMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: collectionApprovalVal.initiatedByMappingId
      });
    }

    for (const incomingPermission of collectionRes.defaultBalances.userPermissions.canUpdateIncomingApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: incomingPermission.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: incomingPermission.initiatedByMappingId
      });
    }

    for (const outgoingPermission of collectionRes.defaultBalances.userPermissions.canUpdateOutgoingApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: outgoingPermission.toMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: outgoingPermission.initiatedByMappingId
      });
    }


    for (const permission of collectionRes.collectionPermissions.canUpdateCollectionApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: permission.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: permission.toMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: permission.initiatedByMappingId
      });
    }

    for (const transfer of collectionRes.defaultBalances.incomingApprovals) {

      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
      });

    }

    for (const transfer of collectionRes.defaultBalances.outgoingApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.toMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
      });
    }

    for (const idx of balanceResIdxs) {
      const balanceRes = responses[idx] as { docs: BalanceDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
      for (const balanceDoc of balanceRes.docs) {
        for (const transfer of balanceDoc.incomingApprovals) {
          addressMappingIdsToFetch.push({
            collectionId: collectionRes.collectionId, mappingId: transfer.fromMappingId
          });
          addressMappingIdsToFetch.push({
            collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
          });

        }

        for (const transfer of balanceDoc.outgoingApprovals) {
          addressMappingIdsToFetch.push({
            collectionId: collectionRes.collectionId, mappingId: transfer.toMappingId
          });
          addressMappingIdsToFetch.push({
            collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
          });
        }
      }
    }
  }

  const uris: { uri: string, collectionId: JSPrimitiveNumberType }[] = [];
  for (const collectionRes of baseCollections) {
    for (const approval of collectionRes.collectionApprovals) {
      const uri = approval.uri;
      if (uri) uris.push({ uri: uri ?? '', collectionId: collectionRes.collectionId });
    }
  }

  const addressMappingsPromise = getAddressMappingsFromDB(addressMappingIdsToFetch, false);
  const uniqueUris = [...new Set(uris.flat())].filter(x => !!x);

  const claimFetchesPromises = uniqueUris.map(uri => fetchUriFromDbAndAddToQueueIfEmpty(uri.uri, BigInt(uri.collectionId).toString()));
  const [addressMappings, claimFetches] = await Promise.all([
    addressMappingsPromise,
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
          fromMapping: addressMappings.find((mapping) => mapping.mappingId === x.fromMappingId) as AddressMapping,
          toMapping: addressMappings.find((mapping) => mapping.mappingId === x.toMappingId) as AddressMapping,
          initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
        }
      }),
      defaultBalances: {
        ...collectionRes.defaultBalances,
        outgoingApprovals: collectionRes.defaultBalances.outgoingApprovals.map(x => {
          return {
            ...x,
            toMapping: addressMappings.find((mapping) => mapping.mappingId === x.toMappingId) as AddressMapping,
            initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
          }
        }),
        incomingApprovals: collectionRes.defaultBalances.incomingApprovals.map(x => {
          return {
            ...x,
            fromMapping: addressMappings.find((mapping) => mapping.mappingId === x.fromMappingId) as AddressMapping,
            initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
          }
        }),
        userPermissions: applyAddressMappingsToUserPermissions(collectionRes.defaultBalances.userPermissions, addressMappings),
      },


      collectionPermissions: {
        ...collectionRes.collectionPermissions,
        canUpdateCollectionApprovals: collectionRes.collectionPermissions.canUpdateCollectionApprovals.map(x => {
          return {
            ...x,
            fromMapping: addressMappings.find((mapping) => mapping.mappingId === x.fromMappingId) as AddressMapping,
            toMapping: addressMappings.find((mapping) => mapping.mappingId === x.toMappingId) as AddressMapping,
            initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
          }
        })
      },

      //Placeholders to be replaced later in function
      activity: [],
      announcements: [],
      reviews: [],
      owners: [],
      merkleChallenges: [],
      approvalsTrackers: [],

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
              fromMapping: addressMappings.find(z => z.mappingId === x.fromMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find(z => z.mappingId === x.initiatedByMappingId) as AddressMapping,
            }
          }),
          outgoingApprovals: doc.outgoingApprovals.map(x => {
            return {
              ...x,
              toMapping: addressMappings.find(z => z.mappingId === x.toMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find(z => z.mappingId === x.initiatedByMappingId) as AddressMapping,
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
        if (view.viewType === 'latestActivity') {
          const viewRes = responses[currPromiseIdx++] as { docs: TransferActivityDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.activity.push(...viewRes.docs.map(x => convertTransferActivityDoc(x, Stringify)));
          type = 'Activity';
        } else if (view.viewType === 'latestAnnouncements') {
          const viewRes = responses[currPromiseIdx++] as { docs: any[], pagination: PaginationInfo };
          collectionToReturn.announcements.push(...viewRes.docs.map(x => convertAnnouncementDoc(x, Stringify)));
          type = 'Announcement';
        } else if (view.viewType === 'latestReviews') {
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
        } else if (view.viewType === 'approvalsTrackers') {
          const viewRes = responses[currPromiseIdx++] as { docs: ApprovalsTrackerDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
          collectionToReturn.approvalsTrackers.push(...viewRes.docs.map(x => convertApprovalsTrackerDoc(x, Stringify)));
          type = 'ApprovalsTracker';
        }

        collectionToReturn.views[view.viewId] = {
          ids: genericViewRes.docs.map((doc) => doc._legacyId),
          type: type,
          pagination: {
            bookmark: genericViewRes.pagination.bookmark || '',
            hasMore: genericViewRes.docs.length === 25
          }
        }
      }
    }

    if (query.merkleChallengeIdsToFetch?.length) {
      const merkleChallengeRes = responses[currPromiseIdx++] as (MerkleChallengeDoc<JSPrimitiveNumberType>)[];
      collectionToReturn.merkleChallenges.push(...merkleChallengeRes.map(x => convertMerkleChallengeDoc(x, Stringify)));
    }

    if (query.approvalsTrackerIdsToFetch?.length) {
      const approvalsTrackerRes = responses[currPromiseIdx++] as (ApprovalsTrackerDoc<JSPrimitiveNumberType>)[];
      collectionToReturn.approvalsTrackers.push(...approvalsTrackerRes.map(x => convertApprovalsTrackerDoc(x, Stringify)));
    }

    if (query.fetchTotalAndMintBalances) {
      const mintAndTotalBalancesRes = responses[currPromiseIdx++] as { docs: BalanceDoc<JSPrimitiveNumberType>[], pagination: PaginationInfo };
      collectionToReturn.owners.push(...getBalanceDocsWithDetails(mintAndTotalBalancesRes.docs));
    }

    //Remove duplicates
    collectionToReturn.activity = collectionToReturn.activity.filter((activity, index, self) => self.findIndex((t) => t._legacyId === activity._legacyId) === index);
    collectionToReturn.announcements = collectionToReturn.announcements.filter((announcement, index, self) => self.findIndex((t) => t._legacyId === announcement._legacyId) === index);
    collectionToReturn.reviews = collectionToReturn.reviews.filter((review, index, self) => self.findIndex((t) => t._legacyId === review._legacyId) === index);
    collectionToReturn.owners = collectionToReturn.owners.filter((owner, index, self) => self.findIndex((t) => t._legacyId === owner._legacyId) === index);
    collectionToReturn.merkleChallenges = collectionToReturn.merkleChallenges.filter((merkleChallenge, index, self) => self.findIndex((t) => t._legacyId === merkleChallenge._legacyId) === index);
    collectionToReturn.approvalsTrackers = collectionToReturn.approvalsTrackers.filter((approvalsTracker, index, self) => self.findIndex((t) => t._legacyId === approvalsTracker._legacyId) === index);


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
          incomingApprovals: appendDefaultForIncomingUserApprovals(balance, addressMappings, balance.cosmosAddress),
          outgoingApprovals: appendDefaultForOutgoingUserApprovals(balance, addressMappings, balance.cosmosAddress)
        }
      });


    }

    collectionResponses.push(convertBitBadgesCollection(collectionToReturn, Stringify));
  }


  //Append fetched approval details
  const pageVisitsPromises = [];
  for (let i = 0; i < collectionResponses.length; i++) {
    const collectionRes = collectionResponses[i];
    for (let i = 0; i < collectionRes.collectionApprovals.length; i++) {
      const approval = collectionRes.collectionApprovals[i];
      if (approval.uri) {
        const claimFetch = claimFetches.find((fetch) => fetch.uri === approval.uri);
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
        _legacyId: `${collectionId}`,
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
    console.log(e);
    console.error(e);
  }
}

export async function executeCollectionsQuery(req: Request, collectionQueries: CollectionQueryOptions[]) {
  const baseCollections = await mustGetManyFromDB(CollectionModel, collectionQueries.map((query) => `${query.collectionId.toString()}`));
  return await executeAdditionalCollectionQueries(req, baseCollections, collectionQueries);
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
      message: 'Error fetching collection. Please try again later.'
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
      message: 'Error fetching badge activity'
    });
  }
}

export const getCollections = async (req: Request, res: Response<GetCollectionBatchRouteResponse<NumberType>>) => {
  try {
    if (req.body.collectionsToFetch.length > 100) {
      return res.status(400).send({
        message: 'For scalability purposes, we limit the number of collections that can be fetched at once to 250. Please design your application to fetch collections in batches of 250 or less.'
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
      message: 'Error fetching collections. Please try again later.'
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
        const [remaining,] = removeUintRangeFromUintRange(otherMatchingBadgeUintRanges, badgeIdsLeft);
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

  const promises = [];
  for (const uri of uris) {
    promises.push(fetchUriFromDbAndAddToQueueIfEmpty(uri, collectionId.toString()));
  }


  const results = await Promise.all(promises) as {
    content: Metadata<JSPrimitiveNumberType> | undefined,
    updating: boolean,
    fetchedAt: bigint,
    fetchedAtBlock: bigint
  }[];

  let collectionMetadata: Metadata<bigint> | undefined = undefined;
  if (!doNotFetchCollectionMetadata) {
    const collectionMetadataResult = results[0];
    if (collectionMetadataResult) {
      collectionMetadata = {
        ...convertMetadata(collectionMetadataResult.content ?? DefaultPlaceholderMetadata, BigIntify),
        _isUpdating: collectionMetadataResult.updating,
        fetchedAt: collectionMetadataResult.fetchedAt,
        fetchedAtBlock: collectionMetadataResult.fetchedAtBlock
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
        fetchedAt: results[resultIdx].fetchedAt,
        fetchedAtBlock: results[resultIdx].fetchedAtBlock
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

export const getMetadataForCollection = async (req: Request, res: Response<GetMetadataForCollectionRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetMetadataForCollectionRouteRequestBody;

    const _collection = await mustGetFromDB(CollectionModel, req.params.collectionId);
    const collection = convertCollectionDoc(_collection, BigIntify);

    const collectionUri = getCurrentValueForTimeline(collection.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify)))?.collectionMetadata.uri ?? '';
    const badgeMetadata = getCurrentValueForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)))?.badgeMetadata.map(x => convertBadgeMetadata(x, BigIntify)) ?? [];

    const metadata = await getMetadata(collection.collectionId, collectionUri, badgeMetadata, reqBody.metadataToFetch);
    return res.json({
      collectionMetadata: metadata.collectionMetadata ? convertMetadata(metadata.collectionMetadata, Stringify) : undefined,
      badgeMetadata: metadata.badgeMetadata ? metadata.badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify)) : undefined
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching collection metadata. Please try again later.'
    })
  }
}
