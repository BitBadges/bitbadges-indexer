import { AddressMapping, BadgeMetadata, JSPrimitiveNumberType, NumberType, UintRange, convertAmountTrackerIdDetails, convertBadgeMetadata, convertBadgeMetadataTimeline, convertCollectionMetadataTimeline, convertCustomDataTimeline, convertIsArchivedTimeline, convertManagerTimeline, convertOffChainBalancesMetadataTimeline, convertStandardsTimeline, convertUintRange, deepCopy } from "bitbadgesjs-proto";
import { AnnouncementDoc, AnnouncementInfo, ApprovalInfoDetails, ApprovalsTrackerDoc, ApprovalsTrackerInfo, ApprovalsTrackerInfoBase, BadgeMetadataDetails, BalanceDoc, BalanceInfo, BalanceInfoWithDetails, BigIntify, BitBadgesCollection, CollectionDoc, DefaultPlaceholderMetadata, DeletableDocument, GetAdditionalCollectionDetailsRequestBody, GetBadgeActivityRouteRequestBody, GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody, GetCollectionRouteResponse, GetMetadataForCollectionRequestBody, GetMetadataForCollectionRouteRequestBody, GetMetadataForCollectionRouteResponse, MerkleChallengeDoc, MerkleChallengeInfo, Metadata, MetadataFetchOptions, ReviewDoc, ReviewInfo, Stringify, TransferActivityDoc, TransferActivityInfo, convertApprovalInfoDetails, convertBadgeMetadataDetails, convertBitBadgesCollection, convertCollectionDoc, convertComplianceDoc, convertMetadata, getBadgeIdsForMetadataId, getCurrentValueForTimeline, getFullBadgeMetadataTimeline, getFullCollectionMetadataTimeline, getFullCustomDataTimeline, getFullIsArchivedTimeline, getFullManagerTimeline, getFullStandardsTimeline, getMetadataIdForBadgeId, getMetadataIdsForUri, getOffChainBalancesMetadataTimeline, getUrisForMetadataIds, removeUintRangeFromUintRange, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-utils";

import CryptoJS from "crypto-js";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { COLLECTIONS_DB } from "../db/db";
import { fetchUriFromDb } from "../queue";
import { compareObjects } from "../utils/compare";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { executeApprovalsTrackersByIdsQuery, executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionApprovalsTrackersQuery, executeCollectionBalancesQuery, executeCollectionMerkleChallengesQuery, executeCollectionReviewsQuery, executeMerkleChallengeByIdsQuery, fetchTotalAndUnmintedBalancesQuery } from "./activityHelpers";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";
import { applyAddressMappingsToUserPermissions } from "./balances";
import { complianceDoc } from "../poll";

const { SHA256 } = CryptoJS;

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

  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    const collectionUri = getCurrentValueForTimeline(collection.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify)))?.collectionMetadata.uri ?? '';
    const badgeMetadata = getCurrentValueForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)))?.badgeMetadata ?? [];

    promises.push(getMetadata(collection.collectionId.toString(), collectionUri, badgeMetadata, query.metadataToFetch));

    const activityBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'latestActivity')?.bookmark;
    const announcementsBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'latestAnnouncements')?.bookmark;
    const reviewsBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'latestReviews')?.bookmark;
    const ownersBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'owners')?.bookmark;
    const claimsBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'merkleChallenges')?.bookmark;
    const approvalsTrackerBookmark = query.viewsToFetch?.find((view) => view.viewKey === 'approvalsTrackers')?.bookmark;

    if (activityBookmark !== undefined) {
      promises.push(executeCollectionActivityQuery(`${query.collectionId}`, activityBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (announcementsBookmark !== undefined) {
      promises.push(executeCollectionAnnouncementsQuery(`${query.collectionId}`, announcementsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (reviewsBookmark !== undefined) {
      promises.push(executeCollectionReviewsQuery(`${query.collectionId}`, reviewsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (ownersBookmark !== undefined) {
      promises.push(executeCollectionBalancesQuery(`${query.collectionId}`, ownersBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (claimsBookmark !== undefined) {
      promises.push(executeCollectionMerkleChallengesQuery(`${query.collectionId}`, claimsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (query.merkleChallengeIdsToFetch?.length) {
      promises.push(executeMerkleChallengeByIdsQuery(`${query.collectionId}`, query.merkleChallengeIdsToFetch));
    } else {
      promises.push(Promise.resolve([]));
    }

    if (query.approvalsTrackerIdsToFetch?.length) {
      promises.push(executeApprovalsTrackersByIdsQuery(`${query.collectionId}`, query.approvalsTrackerIdsToFetch.map(x => convertAmountTrackerIdDetails(x, BigIntify))));
    } else {
      promises.push(Promise.resolve([]));
    }

    if (query.fetchTotalAndMintBalances) {
      promises.push(fetchTotalAndUnmintedBalancesQuery(`${query.collectionId}`));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (approvalsTrackerBookmark !== undefined) {
      promises.push(executeCollectionApprovalsTrackersQuery(`${query.collectionId}`, approvalsTrackerBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }
  }

  //Parse results and add to collectionResponses
  const responses = await Promise.all(promises);

  const addressMappingIdsToFetch: { collectionId: NumberType, mappingId: string }[] = [];
  for (let i = 0; i < responses.length; i += 10) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === collectionQueries[(i) / 10].collectionId.toString());
    if (!collectionRes) continue;

    const balancesRes = responses[i + 4] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
    const mintAndTotalBalancesRes = responses[i + 8] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;

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

    for (const incomingPermission of collectionRes.defaultUserPermissions.canUpdateIncomingApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: incomingPermission.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: incomingPermission.initiatedByMappingId
      });
    }

    for (const outgoingPermission of collectionRes.defaultUserPermissions.canUpdateOutgoingApprovals) {
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

    for (const transfer of collectionRes.defaultUserIncomingApprovals) {

      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.fromMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
      });

    }

    for (const transfer of collectionRes.defaultUserOutgoingApprovals) {
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.toMappingId
      });
      addressMappingIdsToFetch.push({
        collectionId: collectionRes.collectionId, mappingId: transfer.initiatedByMappingId
      });
    }



    for (const balanceDoc of [...balancesRes.docs, ...mintAndTotalBalancesRes.docs]) {
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


  const uris: { uri: string, collectionId: JSPrimitiveNumberType }[] = [];
  for (const collectionRes of baseCollections) {
    for (const approval of collectionRes.collectionApprovals) {
      const uri = approval.uri;
      if (uri) uris.push({ uri: uri ?? '', collectionId: collectionRes.collectionId });
    }
  }

  const addressMappingsPromise = getAddressMappingsFromDB(addressMappingIdsToFetch, false);
  const uniqueUris = [...new Set(uris.flat())].filter(x => !!x);

  const claimFetchesPromises = uniqueUris.map(uri => fetchUriFromDb(uri.uri, BigInt(uri.collectionId).toString()));
  const [addressMappings, claimFetches] = await Promise.all([
    addressMappingsPromise,
    Promise.all(claimFetchesPromises)
  ]);

  for (let i = 0; i < responses.length; i += 10) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId.toString() === collectionQueries[(i) / 10].collectionId.toString());
    if (!collectionRes) continue;

    const query = collectionQueries[(i) / 10];
    const metadataRes: { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: BadgeMetadataDetails<JSPrimitiveNumberType>[] } = responses[i] as { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: BadgeMetadataDetails<JSPrimitiveNumberType>[] };
    const activityRes = responses[i + 1] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
    const announcementsRes = responses[i + 2] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
    const reviewsRes = responses[i + 3] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
    const balancesRes = responses[i + 4] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
    const claimsRes = responses[i + 5] as nano.MangoResponse<MerkleChallengeDoc<JSPrimitiveNumberType>>;
    const specificMerkleChallengesRes = responses[i + 6] as (MerkleChallengeInfo<JSPrimitiveNumberType> & nano.Document & DeletableDocument)[];
    const specificApprovalsTrackersRes = responses[i + 7] as (ApprovalsTrackerInfoBase<JSPrimitiveNumberType> & nano.Document & DeletableDocument)[];
    const mintAndTotalBalancesRes = responses[i + 8] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
    const approvalsTrackersRes = responses[i + 9] as nano.MangoResponse<ApprovalsTrackerDoc<JSPrimitiveNumberType>>;


    const _complianceDoc = complianceDoc ? convertComplianceDoc(complianceDoc, Stringify) : undefined;
    const isNSFW = _complianceDoc?.badges?.nsfw?.find(x => x.collectionId === collectionRes.collectionId);
    const isReported = _complianceDoc?.badges?.reported?.find(x => x.collectionId === collectionRes.collectionId);

    let collectionToReturn: BitBadgesCollection<JSPrimitiveNumberType> = {
      ...collectionRes,
      _rev: undefined,
      _deleted: undefined,
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
      defaultUserPermissions: applyAddressMappingsToUserPermissions(collectionRes.defaultUserPermissions, addressMappings),
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
      defaultUserIncomingApprovals: collectionRes.defaultUserIncomingApprovals.map(x => {
        return {
          ...x,
          fromMapping: addressMappings.find((mapping) => mapping.mappingId === x.fromMappingId) as AddressMapping,
          initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
        }
      }),
      defaultUserOutgoingApprovals: collectionRes.defaultUserOutgoingApprovals.map(x => {
        return {
          ...x,
          toMapping: addressMappings.find((mapping) => mapping.mappingId === x.toMappingId) as AddressMapping,
          initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.initiatedByMappingId) as AddressMapping,
        }
      }),
      activity: activityRes.docs.map(removeCouchDBDetails) as TransferActivityInfo<JSPrimitiveNumberType>[],
      announcements: announcementsRes.docs.map(removeCouchDBDetails) as AnnouncementInfo<JSPrimitiveNumberType>[],
      reviews: reviewsRes.docs.map(removeCouchDBDetails) as ReviewInfo<JSPrimitiveNumberType>[],
      owners: [
        ...balancesRes.docs.map(removeCouchDBDetails) as BalanceInfo<JSPrimitiveNumberType>[],
        ...mintAndTotalBalancesRes.docs.map(removeCouchDBDetails) as BalanceInfo<JSPrimitiveNumberType>[]
      ].filter((balance, idx, self) => self.findIndex((b) => b.cosmosAddress == balance.cosmosAddress) === idx)
        .map((balance) => {
          return {
            ...balance,
            incomingApprovals: balance.incomingApprovals.map(x => {
              return {
                ...x,
                fromMapping: addressMappings.find(z => z.mappingId === x.fromMappingId) as AddressMapping,
                initiatedByMapping: addressMappings.find(z => z.mappingId === x.initiatedByMappingId) as AddressMapping,
              }
            }),
            outgoingApprovals: balance.outgoingApprovals.map(x => {
              return {
                ...x,
                toMapping: addressMappings.find(z => z.mappingId === x.toMappingId) as AddressMapping,
                initiatedByMapping: addressMappings.find(z => z.mappingId === x.initiatedByMappingId) as AddressMapping,
              }
            })
          }
        }) as BalanceInfoWithDetails<JSPrimitiveNumberType>[],
      merkleChallenges: [
        ...claimsRes.docs.map(removeCouchDBDetails) as MerkleChallengeInfo<JSPrimitiveNumberType>[],
        ...specificMerkleChallengesRes.map(removeCouchDBDetails) as MerkleChallengeInfo<JSPrimitiveNumberType>[]
      ].filter((claim, idx, self) => self.findIndex((c) => JSON.stringify(c) === JSON.stringify(claim)) === idx),
      approvalsTrackers: [
        ...specificApprovalsTrackersRes.map(removeCouchDBDetails) as ApprovalsTrackerInfo<JSPrimitiveNumberType>[],
        ...approvalsTrackersRes.docs.map(removeCouchDBDetails) as ApprovalsTrackerInfo<JSPrimitiveNumberType>[]
      ].filter((approval, idx, self) => self.findIndex((a) => JSON.stringify(a) === JSON.stringify(approval)) === idx),
      //Placeholders to be replaced later in function
      cachedBadgeMetadata: [],
      views: {
        'latestActivity': query.viewsToFetch?.find(x => x.viewKey === 'latestActivity') ? {
          ids: activityRes.docs.map((doc) => doc._id),
          type: 'Activity',
          pagination: {
            bookmark: activityRes.bookmark || '',
            hasMore: activityRes.docs.length === 25
          }
        } : undefined,
        'latestAnnouncements': query.viewsToFetch?.find(x => x.viewKey === 'latestAnnouncements') ? {
          ids: announcementsRes.docs.map((doc) => doc._id),
          type: 'Announcement',
          pagination: {
            bookmark: announcementsRes.bookmark || '',
            hasMore: announcementsRes.docs.length === 25
          }
        } : undefined,
        'latestReviews': query.viewsToFetch?.find(x => x.viewKey === 'latestReviews') ? {
          ids: reviewsRes.docs.map((doc) => doc._id),
          type: 'Review',
          pagination: {
            bookmark: reviewsRes.bookmark || '',
            hasMore: reviewsRes.docs.length === 25
          }
        } : undefined,
        'owners': query.viewsToFetch?.find(x => x.viewKey === 'owners') ? {
          ids: balancesRes.docs.map((doc) => doc._id),
          type: 'Balance',
          pagination: {
            bookmark: balancesRes.bookmark || '',
            hasMore: balancesRes.docs.length === 25
          }
        } : undefined,
        'merkleChallenges': query.viewsToFetch?.find(x => x.viewKey === 'merkleChallenges') ? {
          ids: claimsRes.docs.map((doc) => doc._id),
          type: 'MerkleChallenge',
          pagination: {
            bookmark: claimsRes.bookmark || '',
            hasMore: claimsRes.docs.length === 25
          }
        } : undefined,
        'approvalsTrackers': query.viewsToFetch?.find(x => x.viewKey === 'approvalsTrackers') ? {
          ids: approvalsTrackersRes.docs.map((doc) => doc._id),
          type: 'ApprovalsTracker',
          pagination: {
            bookmark: approvalsTrackersRes.bookmark || '',
            hasMore: approvalsTrackersRes.docs.length === 25
          }
        } : undefined,
      }
    };

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
  }



  return collectionResponses;
}

export async function executeCollectionsQuery(req: Request, collectionQueries: CollectionQueryOptions[]) {
  const collectionsResponse = await COLLECTIONS_DB.fetch({ keys: collectionQueries.map((query) => `${query.collectionId.toString()}`) }, { include_docs: true });
  const baseCollections = getDocsFromNanoFetchRes(collectionsResponse);

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

  let badgeMetadataUris: string[] = [];
  if (!doNotFetchCollectionMetadata && collectionUri) {
    badgeMetadataUris = uris.slice(1);
  }

  uris = [...new Set(uris)];
  badgeMetadataUris = [...new Set(badgeMetadataUris)];
  metadataIdsToFetch = metadataIdsToFetch.map((id) => BigInt(id));
  metadataIdsToFetch = [...new Set(metadataIdsToFetch)];

  if (uris.length > 250) {
    throw new Error('For scalability, we limit the number of metadata URIs that can be fetched at once to 250. Please design your application to fetch metadata in batches of 250 or less.');
  }

  const promises = [];
  for (const uri of uris) {
    promises.push(fetchUriFromDb(uri, collectionId.toString()));
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

const batchUpdateBadgeMetadata = (currBadgeMetadata: BadgeMetadataDetails<bigint>[], newBadgeMetadataDetailsArr: BadgeMetadataDetails<bigint>[]) => {


  const allBadgeIds = sortUintRangesAndMergeIfNecessary(
    deepCopy(newBadgeMetadataDetailsArr.map(x => x.badgeIds).flat()), true
  )
  for (let i = 0; i < currBadgeMetadata.length; i++) {
    const val = currBadgeMetadata[i];
    if (!val) continue; //For TS

    const [remaining, _] = removeUintRangeFromUintRange(allBadgeIds, val.badgeIds);
    val.badgeIds = remaining;
  }

  currBadgeMetadata = currBadgeMetadata.filter((val) => val && val.badgeIds.length > 0);


  const hashTable = new Map<string, number>();
  for (let i = 0; i < currBadgeMetadata.length; i++) {
    const metadataDetails = currBadgeMetadata[i];
    const hashedMetadata = SHA256(JSON.stringify(metadataDetails.metadata)).toString();
    hashTable.set(hashedMetadata, i);
  }

  for (const newBadgeMetadataDetails of newBadgeMetadataDetailsArr) {
    let currentMetadata = newBadgeMetadataDetails.metadata;
    for (const badgeUintRange of newBadgeMetadataDetails.badgeIds) {
      const startBadgeId = badgeUintRange.start;
      const endBadgeId = badgeUintRange.end;

      //If the metadata we are updating is already in the array (with matching uri and id), we can just insert the badge IDs
      let currBadgeMetadataExists = false;
      const idx = hashTable.get(SHA256(JSON.stringify(currentMetadata)).toString());
      if (idx) {
        const val = currBadgeMetadata[idx];
        if (!val) continue; //For TS

        if (val.uri === newBadgeMetadataDetails.uri && val.metadataId === newBadgeMetadataDetails.metadataId && val.customData === newBadgeMetadataDetails.customData && val.toUpdate === newBadgeMetadataDetails.toUpdate && compareObjects(val.metadata, currentMetadata)) {
          currBadgeMetadataExists = true;
          if (val.badgeIds.length > 0) {
            val.badgeIds = [...val.badgeIds, { start: startBadgeId, end: endBadgeId }];
            val.badgeIds = sortUintRangesAndMergeIfNecessary(val.badgeIds, true);
          } else {
            val.badgeIds = [{ start: startBadgeId, end: endBadgeId }];
          }
        }
      }

      //Recreate the array with the updated badge IDs
      //If some metadata object no longer has any corresponding badge IDs, we can remove it from the array

      //If we did not find the metadata in the array and metadata !== undefined, we need to add it
      if (!currBadgeMetadataExists) {
        currBadgeMetadata.push({
          metadata: { ...currentMetadata },
          badgeIds: [{
            start: startBadgeId,
            end: endBadgeId,
          }],
          uri: newBadgeMetadataDetails.uri,
          metadataId: newBadgeMetadataDetails.metadataId,
          customData: newBadgeMetadataDetails.customData,
          toUpdate: newBadgeMetadataDetails.toUpdate,
        })

        const hashedMetadata = SHA256(JSON.stringify(newBadgeMetadataDetails.metadata)).toString();
        hashTable.set(hashedMetadata, currBadgeMetadata.length - 1);
      }
    }
  }

  currBadgeMetadata = currBadgeMetadata.filter((val) => val && val.badgeIds.length > 0);
  return currBadgeMetadata;
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

    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
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
