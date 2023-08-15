import { AddressMapping, BadgeMetadata, JSPrimitiveNumberType, NumberType, UintRange, convertApprovalTrackerIdDetails, convertBadgeMetadata, convertBadgeMetadataTimeline, convertCollectionMetadataTimeline, convertContractAddressTimeline, convertCustomDataTimeline, convertInheritedBalancesTimeline, convertIsArchivedTimeline, convertManagerTimeline, convertOffChainBalancesMetadataTimeline, convertStandardsTimeline, convertUintRange } from "bitbadgesjs-proto";
import { getMetadataIdsForUri, AnnouncementDoc, AnnouncementInfo, ApprovalsTrackerDoc, ApprovalsTrackerInfo, ApprovalsTrackerInfoBase, BLANK_USER_INFO, BadgeMetadataDetails, BalanceDoc, BalanceInfo, BalanceInfoWithDetails, BigIntify, BitBadgesCollection, CollectionApprovedTransferTimelineWithDetails, CollectionDoc, DefaultPlaceholderMetadata, DeletableDocument, GetAdditionalCollectionDetailsRequestBody, GetBadgeActivityRouteRequestBody, GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody, GetCollectionRouteResponse, GetMetadataForCollectionRequestBody, GetMetadataForCollectionRouteRequestBody, GetMetadataForCollectionRouteResponse, GetOwnersForBadgeRouteRequestBody, GetOwnersForBadgeRouteResponse, MerkleChallengeDetails, MerkleChallengeDoc, MerkleChallengeInfo, Metadata, MetadataFetchOptions, ReviewDoc, ReviewInfo, Stringify, TransferActivityDoc, TransferActivityInfo, convertBadgeMetadataDetails, convertBalanceDoc, convertBitBadgesCollection, convertBitBadgesUserInfo, convertCollectionApprovedTransferTimelineWithDetails, convertCollectionApprovedTransferWithDetails, convertCollectionDoc, convertMerkleChallengeDetails, convertMetadata, convertUserApprovedIncomingTransferTimelineWithDetails, convertUserApprovedOutgoingTransferTimelineWithDetails, getBadgeIdsForMetadataId, getCurrentValueIdxForTimeline, getFirstMatchForCollectionApprovedTransfers, getFullBadgeMetadataTimeline, getFullCollectionApprovedTransfersTimeline, getFullCollectionMetadataTimeline, getFullContractAddressTimeline, getFullCustomDataTimeline, getFullDefaultUserApprovedIncomingTransfersTimeline, getFullDefaultUserApprovedOutgoingTransfersTimeline, getFullIsArchivedTimeline, getFullManagerTimeline, getFullStandardsTimeline, getInheritedBalancesTimeline, getMetadataIdForBadgeId, getOffChainBalancesMetadataTimeline, getReservedAddressMapping, getUrisForMetadataIds, removeUintRangeFromUintRange, sortUintRangesAndMergeIfNecessary, updateBadgeMetadata } from "bitbadgesjs-utils";

import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { ADDRESS_MAPPINGS_DB, BALANCES_DB, COLLECTIONS_DB, FETCHES_DB } from "../db/db";
import { fetchUriFromDb } from "../metadata-queue";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { executeApprovalsTrackersByIdsQuery, executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionApprovalsTrackersQuery, executeCollectionBalancesQuery, executeCollectionMerkleChallengesQuery, executeCollectionReviewsQuery, executeMerkleChallengeByIdsQuery, fetchTotalAndUnmintedBalancesQuery } from "./activityHelpers";
import { getAccountByAddress } from "./users";
import { appendDefaultForIncomingUserApprovedTransfers, appendDefaultForOutgoingUserApprovedTransfers } from "./utils";

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

export async function executeAdditionalCollectionQueries(baseCollections: CollectionDoc<JSPrimitiveNumberType>[], collectionQueries: CollectionQueryOptions[]) {
  const promises = [];
  const collectionResponses: BitBadgesCollection<JSPrimitiveNumberType>[] = [];

  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId.toString() === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    const collectionIdx = getCurrentValueIdxForTimeline(collection.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify)));
    let collectionUri = "";
    if (collectionIdx !== -1n) {
      collectionUri = collection.collectionMetadataTimeline[Number(collectionIdx)].collectionMetadata.uri;
    }

    const badgeMetadataIdx = getCurrentValueIdxForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)));
    let badgeMetadata: BadgeMetadata<bigint>[] = [];
    if (badgeMetadataIdx !== -1n) {
      badgeMetadata = collection.badgeMetadataTimeline[Number(badgeMetadataIdx)].badgeMetadata.map(x => convertBadgeMetadata(x, BigIntify));
    }


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
      promises.push(executeApprovalsTrackersByIdsQuery(`${query.collectionId}`, query.approvalsTrackerIdsToFetch.map(x => convertApprovalTrackerIdDetails(x, BigIntify))));
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


    let addressMappingIdsToFetch = [];
    for (const collectionApprovedTransferTimelineVal of collectionRes.collectionApprovedTransfersTimeline) {
      for (const collectionApprovedTransferVal of collectionApprovedTransferTimelineVal.collectionApprovedTransfers) {
        addressMappingIdsToFetch.push(collectionApprovedTransferVal.fromMappingId);
        addressMappingIdsToFetch.push(collectionApprovedTransferVal.toMappingId);
        addressMappingIdsToFetch.push(collectionApprovedTransferVal.initiatedByMappingId);
      }
    }

    for (const permission of collectionRes.collectionPermissions.canUpdateCollectionApprovedTransfers) {
      addressMappingIdsToFetch.push(permission.defaultValues.fromMappingId);
      addressMappingIdsToFetch.push(permission.defaultValues.toMappingId);
      addressMappingIdsToFetch.push(permission.defaultValues.initiatedByMappingId);
    }

    for (const balance of collectionRes.defaultUserApprovedIncomingTransfersTimeline) {
      for (const transfer of balance.approvedIncomingTransfers) {
        addressMappingIdsToFetch.push(transfer.fromMappingId);
        addressMappingIdsToFetch.push(transfer.initiatedByMappingId);
      }
    }

    for (const balance of collectionRes.defaultUserApprovedOutgoingTransfersTimeline) {
      for (const transfer of balance.approvedOutgoingTransfers) {
        addressMappingIdsToFetch.push(transfer.toMappingId);
        addressMappingIdsToFetch.push(transfer.initiatedByMappingId);
      }
    }


    for (const balanceDoc of [...balancesRes.docs, ...mintAndTotalBalancesRes.docs]) {
      for (const balance of balanceDoc.approvedIncomingTransfersTimeline) {
        for (const transfer of balance.approvedIncomingTransfers) {
          addressMappingIdsToFetch.push(transfer.fromMappingId);
          addressMappingIdsToFetch.push(transfer.initiatedByMappingId);
        }
      }

      for (const balance of balanceDoc.approvedOutgoingTransfersTimeline) {
        for (const transfer of balance.approvedOutgoingTransfers) {
          addressMappingIdsToFetch.push(transfer.toMappingId);
          addressMappingIdsToFetch.push(transfer.initiatedByMappingId);
        }
      }
    }


    const managerIdx = getCurrentValueIdxForTimeline(collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify)));
    let manager = '';
    if (managerIdx !== -1n) {
      manager = collectionRes.managerTimeline[Number(managerIdx)].manager;
    }

    //TODO: parallelize this
    addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];
    const addressMappings: AddressMapping[] = [];
    for (const mappingId of addressMappingIdsToFetch) {
      const mapping = getReservedAddressMapping(mappingId, manager);
      if (mapping) {
        addressMappings.push(mapping);
        addressMappingIdsToFetch = addressMappingIdsToFetch.filter((x) => x !== mappingId);
      }
    }

    addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

    if (addressMappingIdsToFetch.length > 0) {
      const fetchedAddressMappings = await ADDRESS_MAPPINGS_DB.fetch({ keys: addressMappingIdsToFetch }, { include_docs: true });
      const addressMappingDocs = getDocsFromNanoFetchRes(fetchedAddressMappings);
      addressMappings.push(...addressMappingDocs.map((doc) => removeCouchDBDetails(doc)));
    }

    let collectionToReturn: BitBadgesCollection<JSPrimitiveNumberType> = {
      ...collectionRes,
      _rev: undefined,
      _deleted: undefined,
      collectionApprovedTransfersTimeline: collectionRes.collectionApprovedTransfersTimeline.map(x => {
        return {
          ...x,
          collectionApprovedTransfers: x.collectionApprovedTransfers.map(y => {
            return {
              ...y,
              fromMapping: addressMappings.find((mapping) => mapping.mappingId === y.fromMappingId) as AddressMapping,
              toMapping: addressMappings.find((mapping) => mapping.mappingId === y.toMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
            }
          })
        }
      }),
      collectionPermissions: {
        ...collectionRes.collectionPermissions,
        canUpdateCollectionApprovedTransfers: collectionRes.collectionPermissions.canUpdateCollectionApprovedTransfers.map(x => {
          return {
            ...x,
            defaultValues: {
              ...x.defaultValues,
              fromMapping: addressMappings.find((mapping) => mapping.mappingId === x.defaultValues.fromMappingId) as AddressMapping,
              toMapping: addressMappings.find((mapping) => mapping.mappingId === x.defaultValues.toMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === x.defaultValues.initiatedByMappingId) as AddressMapping,
            }
          }
        })
      },
      defaultUserApprovedIncomingTransfersTimeline: collectionRes.defaultUserApprovedIncomingTransfersTimeline.map(x => {
        return {
          ...x,
          approvedIncomingTransfers: x.approvedIncomingTransfers.map(y => {
            return {
              ...y,
              fromMapping: addressMappings.find((mapping) => mapping.mappingId === y.fromMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
            }
          })
        }
      }),
      defaultUserApprovedOutgoingTransfersTimeline: collectionRes.defaultUserApprovedOutgoingTransfersTimeline.map(x => {
        return {
          ...x,
          approvedOutgoingTransfers: x.approvedOutgoingTransfers.map(y => {
            return {
              ...y,
              toMapping: addressMappings.find((mapping) => mapping.mappingId === y.toMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
            }
          })
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
            approvedIncomingTransfersTimeline: balance.approvedIncomingTransfersTimeline.map(x => {
              return {
                ...x,
                approvedIncomingTransfers: x.approvedIncomingTransfers.map(y => {
                  return {
                    ...y,
                    fromMapping: addressMappings.find(z => z.mappingId === y.fromMappingId) as AddressMapping,
                    initiatedByMapping: addressMappings.find(z => z.mappingId === y.initiatedByMappingId) as AddressMapping,
                  }
                })
              }
            }),
            approvedOutgoingTransfersTimeline: balance.approvedOutgoingTransfersTimeline.map(x => {
              return {
                ...x,
                approvedOutgoingTransfers: x.approvedOutgoingTransfers.map(y => {
                  return {
                    ...y,
                    toMapping: addressMappings.find(z => z.mappingId === y.toMappingId) as AddressMapping,
                    initiatedByMapping: addressMappings.find(z => z.mappingId === y.initiatedByMappingId) as AddressMapping,
                  }
                })
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
      managerInfo: convertBitBadgesUserInfo(BLANK_USER_INFO, Stringify),
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
      collectionToReturn.defaultUserApprovedIncomingTransfersTimeline = getFullDefaultUserApprovedIncomingTransfersTimeline(
        collectionToReturn.defaultUserApprovedIncomingTransfersTimeline.map(x => convertUserApprovedIncomingTransferTimelineWithDetails(x, BigIntify))
      ).map(x => convertUserApprovedIncomingTransferTimelineWithDetails(x, Stringify));
      collectionToReturn.defaultUserApprovedOutgoingTransfersTimeline = getFullDefaultUserApprovedOutgoingTransfersTimeline(
        collectionToReturn.defaultUserApprovedOutgoingTransfersTimeline.map(x => convertUserApprovedOutgoingTransferTimelineWithDetails(x, BigIntify))
      ).map(x => convertUserApprovedOutgoingTransferTimelineWithDetails(x, Stringify));
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
      collectionToReturn.inheritedBalancesTimeline = getInheritedBalancesTimeline(
        collectionToReturn.inheritedBalancesTimeline.map(x => convertInheritedBalancesTimeline(x, BigIntify))
      ).map(x => convertInheritedBalancesTimeline(x, Stringify));
      collectionToReturn.contractAddressTimeline = getFullContractAddressTimeline(
        collectionToReturn.contractAddressTimeline.map(x => convertContractAddressTimeline(x, BigIntify))
      ).map(x => convertContractAddressTimeline(x, Stringify));
      collectionToReturn.standardsTimeline = getFullStandardsTimeline(
        collectionToReturn.standardsTimeline.map(x => convertStandardsTimeline(x, BigIntify))
      ).map(x => convertStandardsTimeline(x, Stringify));
      collectionToReturn.managerTimeline = getFullManagerTimeline(
        collectionToReturn.managerTimeline.map(x => convertManagerTimeline(x, BigIntify))
      ).map(x => convertManagerTimeline(x, Stringify));
      collectionToReturn.collectionApprovedTransfersTimeline = getFullCollectionApprovedTransfersTimeline(
        collectionToReturn.collectionApprovedTransfersTimeline.map(x => convertCollectionApprovedTransferTimelineWithDetails(x, BigIntify))
      ).map(x => convertCollectionApprovedTransferTimelineWithDetails(x as CollectionApprovedTransferTimelineWithDetails<NumberType>, Stringify));

      //Handle all possible values and only return first maches
      collectionToReturn.collectionApprovedTransfersTimeline = collectionToReturn.collectionApprovedTransfersTimeline.map((timeline) => {
        return {
          timelineTimes: timeline.timelineTimes.map(x => convertUintRange(x, BigIntify)),
          collectionApprovedTransfers: getFirstMatchForCollectionApprovedTransfers(timeline.collectionApprovedTransfers.map(x => convertCollectionApprovedTransferWithDetails(x, BigIntify)), true)
        }
      }).map(x => convertCollectionApprovedTransferTimelineWithDetails(x, Stringify));

      collectionToReturn.owners = collectionToReturn.owners.map((balance) => {
        return {
          ...balance,
          approvedIncomingTransfersTimeline: appendDefaultForIncomingUserApprovedTransfers(balance.approvedIncomingTransfersTimeline, addressMappings, balance.cosmosAddress),
          approvedOutgoingTransfersTimeline: appendDefaultForOutgoingUserApprovedTransfers(balance.approvedOutgoingTransfersTimeline, addressMappings, balance.cosmosAddress)
        }
      });
    }

    collectionResponses.push(convertBitBadgesCollection(collectionToReturn, Stringify));
  }

  //For all claims in the collection approved transfers, fetch the merkleChallengeDetails
  //TODO: paginate this somehow, we currently fetch all
  //TODO: Fetch non-Mint as well
  const uris = [];
  for (const collectionRes of collectionResponses) {
    for (const approvedTransferTimeline of collectionRes.collectionApprovedTransfersTimeline) {
      for (const approvedTransfer of approvedTransferTimeline.collectionApprovedTransfers) {
        if (approvedTransfer.fromMappingId == "Mint") {
          for (const approval of approvedTransfer.approvalDetails) {
            uris.push(approval.merkleChallenges.map(x => x.uri));
          }
        }
      }
    }
  }

  const claimFetches = await Promise.all([...new Set(uris.flat())].filter(x => !!x).map((uri) => FETCHES_DB.get(uri)));

  for (const collectionRes of collectionResponses) {
    for (const approvedTransferTimeline of collectionRes.collectionApprovedTransfersTimeline) {
      for (const approvedTransfer of approvedTransferTimeline.collectionApprovedTransfers) {
        if (approvedTransfer.fromMappingId == "Mint") {
          for (const approval of approvedTransfer.approvalDetails) {
            for (const merkleChallenge of approval.merkleChallenges) {
              const claimFetch = claimFetches.find((fetch) => fetch._id === merkleChallenge.uri);
              if (!claimFetch) continue;

              merkleChallenge.details = convertMerkleChallengeDetails(claimFetch.content as MerkleChallengeDetails<JSPrimitiveNumberType>, Stringify);
            }
          }
        }
      }
    }
  }


  const managerKeys = [...new Set(collectionResponses.map((collectionRes) => {
    const _managerTimeline = collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify));
    const idx = getCurrentValueIdxForTimeline(_managerTimeline);
    if (idx == -1n) return undefined;
    return collectionRes.managerTimeline[Number(idx)].manager;
  }).filter((x) => x !== undefined) as string[])];

  if (managerKeys.length > 0) {

    for (const collectionRes of collectionResponses) {
      const _managerTimeline = collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify));
      const idx = getCurrentValueIdxForTimeline(_managerTimeline);
      if (idx == -1n) continue;
      const manager = collectionRes.managerTimeline[Number(idx)].manager;
      collectionRes.managerInfo = manager ? await getAccountByAddress(manager) : convertBitBadgesUserInfo(BLANK_USER_INFO, Stringify);

      // if (managerInfo) {
      //   collectionRes.managerInfo = await convertToBitBadgesUserInfo([managerInfo], [cosmosAccountDetails])[0];
      // }
    }
  }
  return collectionResponses;
}

export async function executeCollectionsQuery(collectionQueries: CollectionQueryOptions[]) {
  const collectionsResponse = await COLLECTIONS_DB.fetch({ keys: collectionQueries.map((query) => `${query.collectionId.toString()}`) }, { include_docs: true });
  const baseCollections = getDocsFromNanoFetchRes(collectionsResponse);

  return await executeAdditionalCollectionQueries(baseCollections, collectionQueries);
}

export const getCollectionById = async (req: Request, res: Response<GetCollectionRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetCollectionByIdRouteRequestBody;

    const collectionsReponse = await executeCollectionsQuery([{
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
    if (req.body.collectionsToFetch.length > 250) {
      return res.status(400).send({
        message: 'For scalability purposes, we limit the number of collections that can be fetched at once to 250. Please design your application to fetch collections in batches of 250 or less.'
      });
    }

    const reqBody = req.body as GetCollectionBatchRouteRequestBody;
    const collectionResponses = await executeCollectionsQuery(reqBody.collectionsToFetch);
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

      while (badgeIdsLeft.length > 0) {
        const currBadgeUintRange = badgeIdsLeft[0];

        const metadataId = getMetadataIdForBadgeId(BigInt(currBadgeUintRange.start), badgeUris);
        if (metadataId === -1) throw new Error(`BadgeId ${currBadgeUintRange.start} does not exist in collection ${collectionId}`);

        metadataIdsToFetch.push(metadataId);
        uris.push(...getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris));

        const otherMatchingBadgeUintRanges = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
        const [remaining,] = removeUintRangeFromUintRange(otherMatchingBadgeUintRanges, badgeIdsLeft);
        badgeIdsLeft = sortUintRangesAndMergeIfNecessary(remaining);

      }
    } else {
      const metadataId = getMetadataIdForBadgeId(BigInt(badgeIdCastedAsNumber), badgeUris);
      if (metadataId === -1) throw new Error(`BadgeId ${badgeIdCastedAsNumber} does not exist in collection ${collectionId}`);

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
    fetchedAt: bigint
  }[];

  console.log(results.map(x => x.fetchedAt));

  let collectionMetadata: Metadata<bigint> | undefined = undefined;
  if (!doNotFetchCollectionMetadata) {
    const collectionMetadataResult = results[0];
    if (collectionMetadataResult) {
      collectionMetadata = {

        ...convertMetadata(collectionMetadataResult.content ?? DefaultPlaceholderMetadata, BigIntify),
        _isUpdating: collectionMetadataResult.updating,
        fetchedAt: collectionMetadataResult.fetchedAt,
      }
    }
  }

  let badgeMetadata: BadgeMetadataDetails<bigint>[] = [];
  for (const metadataId of metadataIdsToFetch) {
    const uri = getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris)[0];
    const badgeIds = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
    const resultIdx = uris.indexOf(uri);
    console.log(results[resultIdx]);
    badgeMetadata = updateBadgeMetadata(badgeMetadata, {
      metadataId: BigInt(metadataId),
      uri,
      badgeIds,
      metadata: {

        ...convertMetadata(results[resultIdx].content ?? DefaultPlaceholderMetadata, BigIntify),
        _isUpdating: results[resultIdx].updating,
        fetchedAt: results[resultIdx].fetchedAt,
      }
    });
  }

  console.log(collectionMetadata, badgeMetadata);

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
    for (const badgeDetails of metadataRes.badgeMetadata) {
      _badgeMetadata = updateBadgeMetadata(_badgeMetadata, convertBadgeMetadataDetails(badgeDetails, BigIntify));
    }
    collection.cachedBadgeMetadata = _badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify));
  }

  return collection;
}

export const getMetadataForCollection = async (req: Request, res: Response<GetMetadataForCollectionRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetMetadataForCollectionRouteRequestBody;

    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, BigIntify);

    const collectionIdx = getCurrentValueIdxForTimeline(collection.collectionMetadataTimeline.map(x => convertCollectionMetadataTimeline(x, BigIntify)));
    let collectionUri = "";
    if (collectionIdx !== -1n) {
      collectionUri = collection.collectionMetadataTimeline[Number(collectionIdx)].collectionMetadata.uri;
    }

    const badgeMetadataIdx = getCurrentValueIdxForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)));
    let badgeMetadata: BadgeMetadata<bigint>[] = [];
    if (badgeMetadataIdx !== -1n) {
      badgeMetadata = collection.badgeMetadataTimeline[Number(badgeMetadataIdx)].badgeMetadata.map(x => convertBadgeMetadata(x, BigIntify));
    }

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

export const getOwnersForBadge = async (req: Request, res: Response<GetOwnersForBadgeRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetOwnersForBadgeRouteRequestBody;

    const totalSupplys = await BALANCES_DB.get(`${req.params.collectionId}:Total`);

    let maxBadgeId = 1n;
    for (const balance of totalSupplys.balances) {
      for (const badgeId of balance.badgeIds) {
        if (BigInt(badgeId.end) > maxBadgeId) {
          maxBadgeId = BigInt(badgeId.end);
        }
      }
    }

    if (BigInt(maxBadgeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
      //TODO: Support string-number queries
      throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
    }

    const ownersResOverview = await BALANCES_DB.partitionInfo(`${req.params.collectionId}`);
    const numOwners = ownersResOverview.doc_count;

    const ownersRes = await BALANCES_DB.partitionedFind(`${req.params.collectionId}`, {
      selector: {
        "balances": {
          "$elemMatch": {
            "badgeIds": {
              "$elemMatch": {
                "$and": [
                  {
                    "start": {
                      "$and": [
                        {
                          "$lte": Number(req.params.badgeId),
                        },
                        {
                          "$type": "number"
                        }
                      ]
                    }
                  },
                  {
                    "end": {
                      "$and": [
                        {
                          "$gte": Number(req.params.badgeId),
                        },
                        {
                          "$type": "number"
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      bookmark: reqBody.bookmark ? reqBody.bookmark : undefined,
    });

    let addressMappingIdsToFetch = [];
    for (const balanceDoc of ownersRes.docs) {
      for (const incomingTimeline of balanceDoc.approvedIncomingTransfersTimeline) {
        for (const incomingTransfer of incomingTimeline.approvedIncomingTransfers) {
          addressMappingIdsToFetch.push(incomingTransfer.fromMappingId);
          addressMappingIdsToFetch.push(incomingTransfer.initiatedByMappingId);
        }
      }

      for (const outgoingTimeline of balanceDoc.approvedOutgoingTransfersTimeline) {
        for (const outgoingTransfer of outgoingTimeline.approvedOutgoingTransfers) {
          addressMappingIdsToFetch.push(outgoingTransfer.toMappingId);
          addressMappingIdsToFetch.push(outgoingTransfer.initiatedByMappingId);
        }
      }
    }

    addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

    const addressMappings: AddressMapping[] = [];

    for (const mappingId of addressMappingIdsToFetch) {
      let manager = '';

      if (mappingId === 'Manager') {
        const collection = await COLLECTIONS_DB.get(req.params.collectionId);
        const collectionRes = convertCollectionDoc(collection, BigIntify);

        const managerIdx = getCurrentValueIdxForTimeline(collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify)));
        if (managerIdx !== -1n) {
          manager = collectionRes.managerTimeline[Number(managerIdx)].manager;
        }
      }

      const mapping = getReservedAddressMapping(mappingId, manager);
      if (mapping) {
        addressMappings.push(mapping);
        addressMappingIdsToFetch = addressMappingIdsToFetch.filter((x) => x !== mappingId);
      }
    }

    addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

    if (addressMappingIdsToFetch.length > 0) {
      const fetchedAddressMappings = await ADDRESS_MAPPINGS_DB.fetch({ keys: addressMappingIdsToFetch }, { include_docs: true });
      const addressMappingDocs = getDocsFromNanoFetchRes(fetchedAddressMappings);
      addressMappings.push(...addressMappingDocs.map((doc) => removeCouchDBDetails(doc)));
    }



    return res.status(200).send({
      owners: ownersRes.docs.map(doc => convertBalanceDoc(doc, Stringify)).map(removeCouchDBDetails).map((balance) => {
        return {
          ...balance,
          approvedIncomingTransfersTimeline: balance.approvedIncomingTransfersTimeline.map(x => {
            return {
              ...x,
              approvedIncomingTransfers: x.approvedIncomingTransfers.map(y => {
                return {
                  ...y,
                  fromMapping: addressMappings.find((mapping) => mapping.mappingId === y.fromMappingId) as AddressMapping,
                  initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
                }
              })
            }
          }),
          approvedOutgoingTransfersTimeline: balance.approvedOutgoingTransfersTimeline.map(x => {
            return {
              ...x,
              approvedOutgoingTransfers: x.approvedOutgoingTransfers.map(y => {
                return {
                  ...y,
                  toMapping: addressMappings.find((mapping) => mapping.mappingId === y.toMappingId) as AddressMapping,
                  initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
                }
              })
            }
          }
          )
        }
      }),
      pagination: {
        bookmark: ownersRes.bookmark || '',
        hasMore: ownersRes.docs.length === 25,
        total: numOwners
      },

    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching owners for collection. Please try again later.'
    });
  }
}
