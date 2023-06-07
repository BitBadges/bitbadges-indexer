import { BadgeUri, JSPrimitiveNumberType, NumberType, convertBadgeUri } from "bitbadgesjs-proto";
import { AnnouncementDoc, AnnouncementInfo, BalanceDoc, BalanceInfo, BigIntify, BitBadgesCollection, BitBadgesUserInfo, ClaimDetails, ClaimDoc, ClaimInfo, CollectionDoc, GetBadgeActivityRouteRequestBody, GetBadgeActivityRouteResponse, GetCollectionBatchRouteRequestBody, GetCollectionBatchRouteResponse, GetCollectionByIdRouteRequestBody, GetCollectionQueryRouteResponse, GetCollectionRouteSuccessResponse, GetMetadataForCollectionRouteRequestBody, GetMetadataForCollectionRouteResponse, GetOwnersForCollectionRouteRequestBody, GetOwnersForCollectionRouteResponse, Metadata, MetadataMap, ReviewDoc, ReviewInfo, Stringify, TransferActivityDoc, TransferActivityInfo, convertBalanceDoc, convertBitBadgesCollection, convertClaimDetails, convertCollectionDoc, convertMetadata, convertMetadataMap, getBadgeIdsForMetadataId, getUrisForMetadataIds, updateMetadataMap } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { BALANCES_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB } from "src/db/db";
import { fetchUriFromDb } from "src/metadata-queue";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "src/utils/couchdb-utils";
import { executeBadgeActivityQuery, executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionBalancesQuery, executeCollectionClaimsQuery, executeCollectionReviewsQuery } from "./activityHelpers";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { getAccountByAddress } from "./users";

/**
 * The executeCollectionsQuery function is the main query function used to fetch all data for a collection in bulk.
 * 
 * collectionId - The collectionId of the collection to fetch
 * startMetadataId - The metadataId to start fetching metadata from (used for pagination). Will fetch 100 metadata documents starting with this id. Default startMetadataId is 0.
 * 
 * Bookmarks are used for pagination. If a bookmark is '', the query will start from the beginning. If a bookmark is undefined, the query will not fetch that data.
 * 
 * activityBookmark - The bookmark to start fetching activity from.
 * announcementsBookmark - The bookmark to start fetching announcements from.
 * reviewsBookmark - The bookmark to start fetching reviews from.
 * balancesBookmark - The bookmark to start fetching balances from.
 * claimsBookmark - The bookmark to start fetching claims from.
 */
interface CollectionQueryOptions {
  collectionId: NumberType,
  startMetadataId?: NumberType,

  activityBookmark?: string,
  announcementsBookmark?: string,
  reviewsBookmark?: string,
  balancesBookmark?: string,
  claimsBookmark?: string
}

export async function executeAdditionalCollectionQueries(baseCollections: CollectionDoc<JSPrimitiveNumberType>[], collectionQueries: CollectionQueryOptions[]) {
  const promises = [];
  const collectionResponses: GetCollectionRouteSuccessResponse[] = [];


  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    const collection = baseCollections.find((collection) => collection.collectionId === query.collectionId.toString());
    if (!collection) throw new Error(`Collection ${query.collectionId} does not exist`);

    promises.push(getMetadata(collection.collectionUri, collection.badgeUris, query.startMetadataId ? BigInt(query.startMetadataId) : 0n, collection.collectionId.toString()));

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

    const metadataRes: { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: MetadataMap<JSPrimitiveNumberType> } = responses[i] as { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: MetadataMap<JSPrimitiveNumberType> };
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
      badgeMetadata: {},
      collectionMetadata: {
        name: '',
        description: '',
        image: '',
      },
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

    collectionResponses.push({
      collection: convertBitBadgesCollection(collectionToReturn, Stringify),
    });
  }

  const claimPromises = [];
  for (const collectionRes of collectionResponses) {
    for (const claim of collectionRes.collection.claims) {
      claimPromises.push(FETCHES_DB.get(claim.uri));
    }
  }

  const claimFetches = await Promise.all(claimPromises);

  for (const collectionRes of collectionResponses) {
    for (const claim of collectionRes.collection.claims) {
      const claimFetch = claimFetches.find((fetch) => fetch._id === claim.uri);
      if (claimFetch && claimFetch.content) {
        claim.details = convertClaimDetails(claimFetch.content as ClaimDetails<JSPrimitiveNumberType>, Stringify);
      }
    }
  }


  const managerKeys = [...new Set(collectionResponses.map((collectionRes) => collectionRes.collection.manager))];

  if (managerKeys.length > 0) {
    const managerInfoRes = await PROFILES_DB.fetch({
      keys: managerKeys
    }, { include_docs: true });
    const docs = getDocsFromNanoFetchRes(managerInfoRes);


    for (const collectionRes of collectionResponses) {
      const managerInfo = docs.find((doc) => doc._id === collectionRes.collection.manager);
      const cosmosAccountDetails = await getAccountByAddress(collectionRes.collection.manager, false);

      if (managerInfo) {
        collectionRes.collection.managerInfo = await convertToBitBadgesUserInfo([managerInfo], [cosmosAccountDetails])[0];
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

export const getCollectionById = async (req: Request, res: Response<GetCollectionQueryRouteResponse>) => {
  try {
    const reqBody = req.body as GetCollectionByIdRouteRequestBody;

    const collectionsReponse = await executeCollectionsQuery([{
      collectionId: BigInt(req.params.collectionId),
      startMetadataId: reqBody.startMetadataId ? BigInt(reqBody.startMetadataId) : 0n,
      activityBookmark: reqBody.activityBookmark,
      announcementsBookmark: reqBody.announcementsBookmark,
      reviewsBookmark: reqBody.reviewsBookmark,
      balancesBookmark: reqBody.balancesBookmark,
      claimsBookmark: reqBody.claimsBookmark
    }]);

    return res.json({
      ...collectionsReponse[0],
    })
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching collection. Please try again later.'
    });
  }
}

export const getBadgeActivity = async (req: Request, res: Response<GetBadgeActivityRouteResponse>) => {
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

export const getCollections = async (req: Request, res: Response<GetCollectionBatchRouteResponse>) => {
  try {
    const reqBody = req.body as GetCollectionBatchRouteRequestBody;

    const queryDetails: CollectionQueryOptions[] = [];
    for (const collectionId of reqBody.collectionIds) {
      queryDetails.push({
        collectionId,
        startMetadataId: reqBody.startMetadataIds[reqBody.collectionIds.indexOf(collectionId)],
        activityBookmark: undefined,
        announcementsBookmark: undefined,
        reviewsBookmark: undefined,
        balancesBookmark: undefined,
        claimsBookmark: undefined
      });
    }

    const collectionResponses = await executeCollectionsQuery(queryDetails);
    return res.status(200).send({
      collections: collectionResponses.map((collectionResponse) => collectionResponse.collection),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching collections. Please try again later.'
    })
  }
}

const getMetadata = async (collectionUri: string, _badgeUris: BadgeUri<NumberType>[], startMetadataId: NumberType, collectionId: NumberType) => {
  const badgeUris = _badgeUris.map((uri) => convertBadgeUri(uri, BigIntify));

  const LIMIT = 100n;
  const startId = BigInt(startMetadataId);

  const idVals = [];
  for (let i = startId; i < startId + LIMIT; i++) {
    idVals.push(BigInt(i));
  }


  const uris: string[] = getUrisForMetadataIds(idVals, collectionUri, badgeUris);
  const promises = [];
  for (const uri of uris) {
    promises.push(fetchUriFromDb(uri, collectionId.toString()));
  }

  const results = await Promise.all(promises) as {
    content: Metadata<JSPrimitiveNumberType>,
    updating: boolean,
  }[];

  let badgeMetadata: MetadataMap<bigint> = {};
  let collectionMetadata: Metadata<bigint> | undefined = undefined;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const metadataRes = convertMetadata(result.content, BigIntify);
    if (i === 0 && startId === 0n) {
      //If first metadata document, we return the collection metadata
      collectionMetadata = convertMetadata(metadataRes, BigIntify);
    } else {
      const badgeUrisToUpdate = getBadgeIdsForMetadataId(BigInt(startId) + BigInt(i), badgeUris);
      for (const badgeUri of badgeUrisToUpdate) {
        badgeMetadata = updateMetadataMap(badgeMetadata, metadataRes, badgeUri, uris[i]);
      }
    }
  }

  return {
    collectionMetadata: collectionMetadata ? convertMetadata(collectionMetadata, Stringify) : undefined,
    badgeMetadata: badgeMetadata ? convertMetadataMap(badgeMetadata, Stringify) : undefined
  }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata: Metadata<JSPrimitiveNumberType>, badgeMetadata: MetadataMap<JSPrimitiveNumberType> }, collection: BitBadgesCollection<JSPrimitiveNumberType> | BitBadgesCollection<JSPrimitiveNumberType>) => {
  // Kinda hacky and inefficient, but metadataRes is the newest metadata, so we just overwrite existing metadata, if exists with same key
  const isCollectionMetadataResEmpty = Object.keys(metadataRes.collectionMetadata).length === 0;
  collection.collectionMetadata = !isCollectionMetadataResEmpty ? metadataRes.collectionMetadata : collection.collectionMetadata;
  collection.badgeMetadata = {
    ...collection.badgeMetadata,
    ...metadataRes.badgeMetadata
  };

  return collection;
}

export const getMetadataForCollection = async (req: Request, res: Response<GetMetadataForCollectionRouteResponse>) => {
  try {
    const reqBody = req.body as GetMetadataForCollectionRouteRequestBody;

    const _collection = await COLLECTIONS_DB.get(req.params.collectionId);
    const collection = convertCollectionDoc(_collection, BigIntify);

    const metadata = await getMetadata(collection.collectionUri, collection.badgeUris, reqBody.startMetadataId ? reqBody.startMetadataId : 0, collection.collectionId);
    return res.json({
      collectionMetadata: metadata.collectionMetadata ? convertMetadata(metadata.collectionMetadata, Stringify) : undefined,
      badgeMetadata: metadata.badgeMetadata ? convertMetadataMap(metadata.badgeMetadata, Stringify) : undefined
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching collection metadata. Please try again later.'
    })
  }
}

export const getOwnersForCollection = async (req: Request, res: Response<GetOwnersForCollectionRouteResponse>) => {
  try {
    const reqBody = req.body as GetOwnersForCollectionRouteRequestBody;

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
