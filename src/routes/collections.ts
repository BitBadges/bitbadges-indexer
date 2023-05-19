import { BitBadgeCollection, GetCollectionResponse, Metadata, MetadataMap, s_Account, s_AnnouncementActivityItem, s_BalanceDocument, s_BitBadgeCollection, s_BitBadgesUserInfo, s_ClaimDocument, s_Collection, s_ReviewActivityItem, s_TransferActivityItem, updateMetadataMap } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, BALANCES_DB, COLLECTIONS_DB, METADATA_DB } from "../db/db";
import { executeCollectionActivityQuery, executeCollectionAnnouncementsQuery, executeCollectionBalancesQuery, executeCollectionClaimsQuery, executeCollectionReviewsQuery } from "./activityHelpers";
import { convertToBitBadgesUserInfo } from "./userHelpers";

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
  collectionId: bigint,
  startMetadataId: bigint,

  activityBookmark: string | undefined,
  announcementsBookmark: string | undefined,
  reviewsBookmark: string | undefined,
  balancesBookmark: string | undefined,
  claimsBookmark: string | undefined
}

async function executeCollectionsQuery(collectionQueries: CollectionQueryOptions[]) {
  const collectionResponses: GetCollectionResponse[] = [];
  const promises = [];

  //Fetch all base collection details in bulk
  promises.push(COLLECTIONS_DB.fetch({ keys: collectionQueries.map((query) => `${query.collectionId}`) }));

  //Fetch metadata, activity, announcements, and reviews for each collection
  for (const query of collectionQueries) {
    promises.push(getMetadata(query.collectionId, query.startMetadataId));

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
  const collectionResponse: nano.DocumentFetchResponse<s_Collection> = responses[0] as nano.DocumentFetchResponse<s_Collection>;
  const baseCollections = collectionResponse.rows.map((row: any) => row.doc) as s_Collection[];

  for (let i = 1; i < responses.length; i += 6) {
    const collectionRes = baseCollections.find((collection) => collection.collectionId === collectionQueries[(i - 1) / 6].collectionId.toString());
    if (!collectionRes) continue;

    const metadataRes: { collectionMetadata: Metadata, badgeMetadata: MetadataMap } = responses[i] as { collectionMetadata: Metadata, badgeMetadata: MetadataMap };
    const activityRes = responses[i + 1] as nano.MangoResponse<s_TransferActivityItem | s_AnnouncementActivityItem | s_ReviewActivityItem>;
    const announcementsRes = responses[i + 2] as nano.MangoResponse<s_TransferActivityItem | s_AnnouncementActivityItem | s_ReviewActivityItem>;
    const reviewsRes = responses[i + 3] as nano.MangoResponse<s_TransferActivityItem | s_AnnouncementActivityItem | s_ReviewActivityItem>;
    const balancesRes = responses[i + 4] as nano.MangoResponse<s_BalanceDocument>;
    const claimsRes = responses[i + 5] as nano.MangoResponse<s_ClaimDocument>;

    let collectionToReturn: s_BitBadgeCollection = {
      ...collectionRes,
      activity: activityRes.docs as s_TransferActivityItem[],
      announcements: announcementsRes.docs as s_AnnouncementActivityItem[],
      reviews: reviewsRes.docs as s_ReviewActivityItem[],
      balances: balancesRes.docs as s_BalanceDocument[],
      claims: claimsRes.docs as s_ClaimDocument[],


      //Placeholders to append later in function
      badgeMetadata: {},
      collectionMetadata: {} as Metadata,
      managerInfo: {} as s_BitBadgesUserInfo,
    };

    const appendedCollection = appendMetadataResToCollection(metadataRes, collectionToReturn);
    collectionToReturn.badgeMetadata = appendedCollection.badgeMetadata;
    collectionToReturn.collectionMetadata = appendedCollection.collectionMetadata;

    collectionResponses.push({
      collection: collectionToReturn,
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
    });
  }


  const managerKeys = [...new Set(collectionResponses.map((collectionRes) => collectionRes.collection.manager))];



  if (managerKeys.length > 0) {
    const managerInfoRes = await ACCOUNTS_DB.find({
      selector: {
        accountNumber: { $in: managerKeys }
      },
      limit: managerKeys.length
    });

    for (const collectionRes of collectionResponses) {
      const managerInfo = managerInfoRes.docs.find((account: s_Account) => account.cosmosAddress === collectionRes.collection.manager);
      if (managerInfo) {
        collectionRes.collection.managerInfo = await convertToBitBadgesUserInfo([managerInfo])[0];
      }
    }
  }

  return collectionResponses;
}

export const getCollectionById = async (req: Request, res: Response) => {
  try {
    const collectionsReponse = await executeCollectionsQuery([{
      collectionId: BigInt(req.params.id),
      startMetadataId: req.body.startMetadataId ? BigInt(req.body.startMetadataId) : 0n,
      activityBookmark: req.body.activityBookmark,
      announcementsBookmark: req.body.announcementsBookmark,
      reviewsBookmark: req.body.reviewsBookmark,
      balancesBookmark: req.body.balancesBookmark,
      claimsBookmark: req.body.claimsBookmark
    }]);

    return res.json({
      ...collectionsReponse[0],
    })
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Error fetching collection' });
  }
}

export const getBadgeActivity = async (req: Request, res: Response) => {
  try {
    const activityRes = await executeCollectionActivityQuery(req.params.id, req.body.bookmark, req.params.badgeId);

    return res.json({
      pagination: {
        activity: {
          bookmark: activityRes.bookmark,
          hasMore: activityRes.docs.length === 25,
        }
      },
      activity: activityRes.docs as s_TransferActivityItem[],
    })
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Error fetching badge activity' });
  }
}

export const getCollections = async (req: Request, res: Response) => {
  try {
    const queryDetails: CollectionQueryOptions[] = [];
    for (const collectionId of req.body.collections) {
      queryDetails.push({
        collectionId,
        startMetadataId: req.body.startMetadataIds[req.body.collections.indexOf(collectionId)],
        activityBookmark: undefined,
        announcementsBookmark: undefined,
        reviewsBookmark: undefined,
        balancesBookmark: undefined,
        claimsBookmark: undefined
      });
    }

    const collectionResponses = await executeCollectionsQuery(queryDetails);
    return res.status(200).send({ collections: collectionResponses.map((collectionResponse) => collectionResponse.collection), paginations: collectionResponses.map((collectionResponse) => collectionResponse.pagination) });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      collections: [],
      error: 'Error fetching collections. Please try again later.'
    })
  }
}

export const queryCollections = async (req: Request, res: Response) => {
  try {
    const response = await COLLECTIONS_DB.find({
      selector: req.body.selector,
      limit: req.body.limit,
      bookmark: req.body.bookmark,
    });

    return res.json({
      collections: response.docs,
    })
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: 'Error fetching collections. Please try again later.'
    })
  }
}

const getMetadata = async (collectionId: bigint, startMetadataId: bigint) => {
  const LIMIT = 100;
  const startId = Number(startMetadataId);

  //Fetch 100 at a time
  const response = await METADATA_DB.partitionedFind(`${collectionId}`, {
    selector: {
      "id": {
        "$and": [
          {
            "$gte": startId && !isNaN(startId) ? startId : 0,
          },
          {
            "$lte": startId && !isNaN(startId) ? startId + LIMIT : LIMIT,
          }
        ]
      }
    },
    limit: LIMIT + 1,
  })

  let badgeMetadata: MetadataMap = {};
  let collectionMetadata: Metadata | undefined = undefined;
  for (const doc of response.docs) {
    if (doc.isCollection) {
      collectionMetadata = doc.metadata;
    } else {
      for (const badgeId of doc.badgeIds) {
        badgeMetadata = updateMetadataMap(badgeMetadata, doc.metadata, badgeId, doc.uri);
      }
    }
  }

  return {
    collectionMetadata: { ...collectionMetadata },
    badgeMetadata
  }
}

const appendMetadataResToCollection = (metadataRes: { collectionMetadata: Metadata, badgeMetadata: MetadataMap }, collection: BitBadgeCollection | s_BitBadgeCollection) => {
  // Kinda hacky and inefficient, but metadataRes is the newest metadata, so we just overwrite existing metadata, if exists with same key
  const isCollectionMetadataResEmpty = Object.keys(metadataRes.collectionMetadata).length === 0;
  collection.collectionMetadata = !isCollectionMetadataResEmpty ? metadataRes.collectionMetadata : collection.collectionMetadata;
  collection.badgeMetadata = {
    ...collection.badgeMetadata,
    ...metadataRes.badgeMetadata
  };

  return collection;
}

export const getMetadataForCollection = async (req: Request, res: Response) => {
  try {
    const metadata = await getMetadata(BigInt(req.params.id), BigInt(req.body.startMetadataId));
    return res.json(metadata)
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: 'Error fetching collection metadata. Please try again later.'
    })
  }
}

export const getOwnersForCollection = async (req: Request, res: Response) => {
  try {
    //In the future, this may be a significant query, but, for now, this is fine because it is a partitionedFind
    //and the number of owners will be relatively small
    const balancesRes = await BALANCES_DB.partitionedFind(`${req.params.id}`, {
      selector: {
        "balances": {
          "$elemMatch": {
            "badgeIds": {
              "$elemMatch": {
                "$and": [
                  {
                    "start": {
                      "$lte": Number(req.params.badgeId),
                    }
                  },
                  {
                    "end": {
                      "$gte": Number(req.params.badgeId),
                    }
                  }
                ]
              }
            }
          }
        }
      },
      bookmark: req.body.bookmark,
    });

    return res.status(200).send({
      balances: balancesRes.docs,
    });
  } catch (e) {
    return res.status(500).send({ error: e });
  }
}
