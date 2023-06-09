import { BadgeUri, IdRange, JSPrimitiveNumberType, NumberType, convertBadgeUri, convertIdRange } from "bitbadgesjs-proto";
import { AnnouncementDoc, AnnouncementInfo, BadgeMetadataDetails, BalanceDoc, BalanceInfo, BigIntify, BitBadgesCollection, BitBadgesUserInfo, ClaimDetails, ClaimDoc, ClaimInfo, CollectionDoc, GetAdditionalCollectionDetailsRequestBody, GetBadgeActivityRouteRequestBody, GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody, GetCollectionRouteResponse, GetMetadataForCollectionRequestBody, GetMetadataForCollectionRouteRequestBody, GetMetadataForCollectionRouteResponse, GetOwnersForBadgeRouteRequestBody, GetOwnersForBadgeRouteResponse, Metadata, MetadataFetchOptions, ReviewDoc, ReviewInfo, Stringify, TransferActivityDoc, TransferActivityInfo, convertBadgeMetadataDetails, convertBalanceDoc, convertBitBadgesCollection, convertClaimDetails, convertCollectionDoc, convertMetadata, getBadgeIdsForMetadataId, getMetadataIdForBadgeId, getUrisForMetadataIds, removeIdsFromIdRange, updateBadgeMetadata } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { BALANCES_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB } from "../db/db";
import { fetchUriFromDb } from "../metadata-queue";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionBalancesQuery, executeCollectionClaimsQuery, executeCollectionReviewsQuery } from "./activityHelpers";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { getAccountByAddress } from "./users";

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
 * balancesBookmark - The bookmark to start fetching balances from.
 * claimsBookmark - The bookmark to start fetching claims from.
 */
type CollectionQueryOptions = ({ collectionId: NumberType } & GetMetadataForCollectionRequestBody & GetAdditionalCollectionDetailsRequestBody);

export async function executeAdditionalCollectionQueries(baseCollections: CollectionDoc<JSPrimitiveNumberType>[], collectionQueries: CollectionQueryOptions[]) {
  const promises = [];
  const collectionResponses: BitBadgesCollection<JSPrimitiveNumberType>[] = [];

  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    promises.push(getMetadata(collection.collectionId.toString(), collection.collectionUri, collection.badgeUris, query.metadataToFetch));

    if (query.activityBookmark !== undefined) {
      promises.push(executeCollectionActivityQuery(`${query.collectionId}`, query.activityBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (query.announcementsBookmark !== undefined) {
      promises.push(executeCollectionAnnouncementsQuery(`${query.collectionId}`, query.announcementsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (query.reviewsBookmark !== undefined) {
      promises.push(executeCollectionReviewsQuery(`${query.collectionId}`, query.reviewsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (query.balancesBookmark !== undefined) {
      promises.push(executeCollectionBalancesQuery(`${query.collectionId}`, query.balancesBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }

    if (query.claimsBookmark !== undefined) {
      promises.push(executeCollectionClaimsQuery(`${query.collectionId}`, query.claimsBookmark));
    } else {
      promises.push(Promise.resolve({ docs: [] }));
    }
  }


  //Parse results and add to collectionResponses
  const responses = await Promise.all(promises);


  for (let i = 0; i < responses.length; i += 6) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId === collectionQueries[(i) / 6].collectionId.toString());
    if (!collectionRes) continue;

    const metadataRes: { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: BadgeMetadataDetails<JSPrimitiveNumberType>[] } = responses[i] as { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: BadgeMetadataDetails<JSPrimitiveNumberType>[] };
    const activityRes = responses[i + 1] as nano.MangoResponse<TransferActivityDoc<JSPrimitiveNumberType>>;
    const announcementsRes = responses[i + 2] as nano.MangoResponse<AnnouncementDoc<JSPrimitiveNumberType>>;
    const reviewsRes = responses[i + 3] as nano.MangoResponse<ReviewDoc<JSPrimitiveNumberType>>;
    const balancesRes = responses[i + 4] as nano.MangoResponse<BalanceDoc<JSPrimitiveNumberType>>;
    const claimsRes = responses[i + 5] as nano.MangoResponse<ClaimDoc<JSPrimitiveNumberType>>;

    let collectionToReturn: BitBadgesCollection<JSPrimitiveNumberType> = {
      ...collectionRes,
      _id: undefined,
      _rev: undefined,
      _deleted: undefined,
      activity: activityRes.docs.map(removeCouchDBDetails) as TransferActivityInfo<JSPrimitiveNumberType>[],
      announcements: announcementsRes.docs.map(removeCouchDBDetails) as AnnouncementInfo<JSPrimitiveNumberType>[],
      reviews: reviewsRes.docs.map(removeCouchDBDetails) as ReviewInfo<JSPrimitiveNumberType>[],
      balances: balancesRes.docs.map(removeCouchDBDetails) as BalanceInfo<JSPrimitiveNumberType>[],
      claims: claimsRes.docs.map(removeCouchDBDetails) as ClaimInfo<JSPrimitiveNumberType>[],


      //Placeholders to be replaced later in function
      badgeMetadata: [],
      managerInfo: {} as BitBadgesUserInfo<JSPrimitiveNumberType>,

      pagination: {
        activity: {
          bookmark: activityRes.bookmark || '',
          hasMore: activityRes.docs.length === 25
        },
        announcements: {
          bookmark: announcementsRes.bookmark || '',
          hasMore: announcementsRes.docs.length === 25
        },
        reviews: {
          bookmark: reviewsRes.bookmark || '',
          hasMore: reviewsRes.docs.length === 25
        },
        balances: {
          bookmark: balancesRes.bookmark || '',
          hasMore: balancesRes.docs.length === 25
        },
        claims: {
          bookmark: claimsRes.bookmark || '',
          hasMore: claimsRes.docs.length === 25
        }
      }
    };

    const appendedCollection = appendMetadataResToCollection(metadataRes, collectionToReturn);
    collectionToReturn.badgeMetadata = appendedCollection.badgeMetadata;
    collectionToReturn.collectionMetadata = appendedCollection.collectionMetadata;

    collectionResponses.push(convertBitBadgesCollection(collectionToReturn, Stringify));
  }

  const claimPromises = [];
  for (const collectionRes of collectionResponses) {
    for (const claim of collectionRes.claims) {
      claimPromises.push(FETCHES_DB.get(claim.uri));
    }
  }

  const claimFetches = await Promise.all(claimPromises);

  for (const collectionRes of collectionResponses) {
    for (const claim of collectionRes.claims) {
      const claimFetch = claimFetches.find((fetch) => fetch._id === claim.uri);
      if (claimFetch && claimFetch.content) {
        claim.details = convertClaimDetails(claimFetch.content as ClaimDetails<JSPrimitiveNumberType>, Stringify);
      }
    }
  }


  const managerKeys = [...new Set(collectionResponses.map((collectionRes) => collectionRes.manager))];

  if (managerKeys.length > 0) {
    const managerInfoRes = await PROFILES_DB.fetch({
      keys: managerKeys
    }, { include_docs: true });
    const docs = getDocsFromNanoFetchRes(managerInfoRes);


    for (const collectionRes of collectionResponses) {
      const managerInfo = docs.find((doc) => doc._id === collectionRes.manager);
      const cosmosAccountDetails = await getAccountByAddress(collectionRes.manager);

      if (managerInfo) {
        collectionRes.managerInfo = await convertToBitBadgesUserInfo([managerInfo], [cosmosAccountDetails])[0];
      }
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
      activityBookmark: reqBody.activityBookmark,
      announcementsBookmark: reqBody.announcementsBookmark,
      reviewsBookmark: reqBody.reviewsBookmark,
      balancesBookmark: reqBody.balancesBookmark,
      claimsBookmark: reqBody.claimsBookmark
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

const getMetadata = async (collectionId: NumberType, collectionUri: string, _badgeUris: BadgeUri<NumberType>[], fetchOptions?: MetadataFetchOptions) => {
  const badgeUris = _badgeUris.map((uri) => convertBadgeUri(uri, BigIntify));

  const doNotFetchCollectionMetadata = fetchOptions?.doNotFetchCollectionMetadata;
  const metadataIds = fetchOptions?.metadataIds ? fetchOptions.metadataIds : [];
  const urisToFetch = fetchOptions?.uris ? fetchOptions.uris : [];
  const badgeIdsToFetch = fetchOptions?.badgeIds ? fetchOptions.badgeIds : [];

  let uris: string[] = [];
  let metadataIdsToFetch: NumberType[] = [];

  if (!doNotFetchCollectionMetadata) uris.push(collectionUri);
  uris.push(...urisToFetch);

  for (const metadataId of metadataIds) {
    const metadataIdCastedAsIdRange = metadataId as IdRange<NumberType>;
    const metadataIdCastedAsNumber = metadataId as NumberType;
    if (metadataIdCastedAsIdRange.start && metadataIdCastedAsIdRange.end) {
      const start = BigInt(metadataIdCastedAsIdRange.start);
      const end = BigInt(metadataIdCastedAsIdRange.end);
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
    const badgeIdCastedAsIdRange = badgeId as IdRange<NumberType>;
    const badgeIdCastedAsNumber = badgeId as NumberType;
    if (badgeIdCastedAsIdRange.start && badgeIdCastedAsIdRange.end) {
      const badgeIdsLeft = [convertIdRange(badgeIdCastedAsIdRange, BigIntify)]

      while (badgeIdsLeft.length > 0) {
        const currBadgeIdRange = badgeIdsLeft.pop();
        if (!currBadgeIdRange) continue;

        const metadataId = getMetadataIdForBadgeId(BigInt(currBadgeIdRange.start), badgeUris);
        if (metadataId === -1) continue;

        metadataIdsToFetch.push(metadataId);
        uris.push(...getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris));

        const otherMatchingBadgeIdRanges = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
        for (const badgeIdRange of otherMatchingBadgeIdRanges) {
          const updatedBadgeIdRanges = removeIdsFromIdRange(badgeIdRange, currBadgeIdRange);
          if (updatedBadgeIdRanges.length > 0) {
            badgeIdsLeft.push(...updatedBadgeIdRanges);
          }
        }
      }
    } else {
      const metadataId = getMetadataIdForBadgeId(BigInt(badgeIdCastedAsNumber), badgeUris);
      if (metadataId === -1) continue;

      uris.push(...getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris));
      metadataIdsToFetch.push(metadataId);
    }
  }
  let badgeMetadataUris: string[] = [];
  if (uris.length > 0) {
    badgeMetadataUris = uris.slice(1);
  }

  uris = [...new Set(uris)];
  badgeMetadataUris = [...new Set(badgeMetadataUris)];
  metadataIdsToFetch = metadataIdsToFetch.map((id) => BigInt(id));
  metadataIdsToFetch = [...new Set(metadataIdsToFetch)];

  if (uris.length > 250) {
    throw new Error('For scalability purposes, we limit the number of metadata URIs that can be fetched at once to 250. Please design your application to fetch metadata in batches of 250 or less.');
  }

  const promises = [];
  for (const uri of uris) {
    promises.push(fetchUriFromDb(uri, collectionId.toString()));
  }

  const results = await Promise.all(promises) as {
    content: Metadata<JSPrimitiveNumberType>,
    updating: boolean,
  }[];


  let collectionMetadata: Metadata<bigint> | undefined = undefined;
  if (!doNotFetchCollectionMetadata) {
    const collectionMetadataResult = results[0];
    if (collectionMetadataResult) {
      collectionMetadata = {
        _isUpdating: collectionMetadataResult.updating,
        ...convertMetadata(collectionMetadataResult.content, BigIntify)
      }
    }
  }

  let badgeMetadata: BadgeMetadataDetails<bigint>[] = [];
  for (const metadataId of metadataIdsToFetch) {
    const uri = getUrisForMetadataIds([BigInt(metadataId)], collectionUri, badgeUris)[0];
    const badgeIds = getBadgeIdsForMetadataId(BigInt(metadataId), badgeUris);
    const resultIdx = uris.indexOf(uri);

    badgeMetadata = updateBadgeMetadata(badgeMetadata, {
      metadataId: BigInt(metadataId),
      uri,
      badgeIds,
      metadata: {
        _isUpdating: results[resultIdx].updating,
        ...convertMetadata(results[resultIdx].content, BigIntify)
      }
    });
  }

  return {
    collectionMetadata: collectionMetadata ? convertMetadata(collectionMetadata, Stringify) : undefined,
    badgeMetadata: badgeMetadata ? badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify)) : undefined
  }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata?: Metadata<JSPrimitiveNumberType>, badgeMetadata?: BadgeMetadataDetails<JSPrimitiveNumberType>[] }, collection: BitBadgesCollection<JSPrimitiveNumberType> | BitBadgesCollection<JSPrimitiveNumberType>) => {
  // Kinda hacky and inefficient, but metadataRes is the newest metadata, so we just overwrite existing metadata, if exists with same key
  const isCollectionMetadataResEmpty = !metadataRes.collectionMetadata || Object.keys(metadataRes.collectionMetadata).length === 0;
  collection.collectionMetadata = !isCollectionMetadataResEmpty ? metadataRes.collectionMetadata : collection.collectionMetadata;
  if (metadataRes.badgeMetadata) {
    let _badgeMetadata = collection.badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, BigIntify));
    for (const badgeDetails of metadataRes.badgeMetadata) {
      _badgeMetadata = updateBadgeMetadata(_badgeMetadata, convertBadgeMetadataDetails(badgeDetails, BigIntify));
    }
    collection.badgeMetadata = _badgeMetadata.map((metadata) => convertBadgeMetadataDetails(metadata, Stringify));
  }

  return collection;
}

export const getMetadataForCollection = async (req: Request, res: Response<GetMetadataForCollectionRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetMetadataForCollectionRouteRequestBody;

    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, BigIntify);

    const metadata = await getMetadata(collection.collectionId, collection.collectionUri, collection.badgeUris, reqBody.metadataToFetch);
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

    const collection = await COLLECTIONS_DB.get(req.params.collectionId);
    if (BigInt(collection.nextBadgeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
      //TODO: Support string-number queries
      throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us in the event that you see this error.');
    }

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


    return res.status(200).send({
      balances: ownersRes.docs.map(doc => convertBalanceDoc(doc, Stringify)).map(removeCouchDBDetails),
    });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching owners for collection. Please try again later.'
    });
  }
}
