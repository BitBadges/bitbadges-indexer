import {
  BadgeMetadata,
  BigIntify,
  BitBadgesUserInfo,
  Metadata,
  SupportedChain,
  UintRangeArray,
  convertToBtcAddress,
  convertToCosmosAddress,
  convertToEthAddress,
  getBadgeIdsForMetadataId,
  getChainForAddress,
  getMetadataIdsForUri,
  isAddressValid,
  type BitBadgesCollection,
  type ErrorResponse,
  type FilterBadgesInCollectionPayload,
  type GetSearchPayload,
  type NumberType,
  type iAccountDoc,
  type iGetSearchSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { convertDocs, getManyFromDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AccountModel, AddressListModel, CollectionModel, ComplianceModel, FetchModel, PageVisitsModel, ProfileModel } from '../db/schemas';
import { getQueryParamsFromBookmark } from '../db/utils';

import typia from 'typia';
import { executeAdditionalCollectionQueries } from './collections';
import { convertToBitBadgesUserInfo } from './userHelpers';
import { mustGetAddressListsFromDB } from './utils';

export const getFilterSuggestionsHandler = async (req: Request, res: Response) => {
  try {
    typia.assert<NumberType>(req.params.collectionId);
    const collectionId = BigIntify(req.params.collectionId);
    const collection = await mustGetFromDB(CollectionModel, `${collectionId}`);
    const badgeMetadata = collection.getBadgeMetadataTimelineValue();
    const firstMatchesTimeline = BadgeMetadata.getFirstMatches(badgeMetadata ?? []);
    const currentMetadataUris = firstMatchesTimeline.map((x) => x.uri);

    const metadataQuery: any = {
      db: { $eq: 'Metadata' },
      $or: [
        {
          _docId: {
            $in: currentMetadataUris
          }
        },
        {
          _docId: {
            // replace {id} with any number and see if it matches
            $regex: `^${currentMetadataUris[0].replace('{id}', '[0-9]+')}$`
          }
        }
      ]
    };

    const metadata = await findInDB(FetchModel, {
      query: { ...metadataQuery },
      limit: 1000,
      sort: { _id: -1 }
    });

    const response: {
      tags: { value: string; count: number }[];
      attributes: { name: string; value: string | number | boolean; count: number; type?: 'date' | 'url' | undefined }[];
    } = {
      tags: [],
      attributes: []
    };

    for (const doc of metadata) {
      const badgeIdMatches = new UintRangeArray<bigint>();
      for (const timeline of firstMatchesTimeline) {
        const regexp = new RegExp(`^${timeline.uri.replace('{id}', '[0-9]+')}$`);
        if (regexp.test(doc._docId)) {
          badgeIdMatches.push(...timeline.badgeIds);
        }
      }

      const content = doc.content;
      if (!content || doc.db !== 'Metadata') continue;

      const metadata = content as Metadata<bigint>;

      if (metadata.tags) {
        for (const tag of metadata.tags) {
          const existing = response.tags.find((x) => x.value === tag);
          if (existing) {
            existing.count = existing.count + Number(badgeIdMatches.size());
          } else {
            response.tags.push({
              value: tag,
              count: Number(badgeIdMatches.size())
            });
          }
        }
      }

      if (metadata.attributes) {
        for (const attr of metadata.attributes) {
          const existing = response.attributes.find((x) => x.name === attr.name && x.value === attr.value);
          if (existing) {
            existing.count = existing.count + Number(badgeIdMatches.size());
          } else {
            response.attributes.push({
              name: attr.name,
              value: attr.value,
              count: Number(badgeIdMatches.size()),
              type: attr.type
            });
          }
        }
      }
    }

    response.tags = response.tags.sort((a, b) => b.count - a.count);
    response.attributes = response.attributes.sort((a, b) => b.count - a.count);

    return res.status(200).send(response);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      message: `Error filtering badges in collection ${req.body.collectionId}.`
    });
  }
};

export const filterBadgesInCollectionHandler = async (req: Request, res: Response) => {
  try {
    const { categories, tags, badgeIds, mostViewed, bookmark, attributes } = req.body as unknown as FilterBadgesInCollectionPayload;
    const validateRes: typia.IValidation<FilterBadgesInCollectionPayload> = typia.validate<FilterBadgesInCollectionPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    typia.assert<NumberType>(req.params.collectionId);

    const collectionId = BigIntify(req.params.collectionId);
    const collection = await mustGetFromDB(CollectionModel, `${collectionId}`);

    // This is a special view incompatible with the others
    if (mostViewed) {
      const mostViewedBadgesDoc = await mustGetFromDB(PageVisitsModel, `${collectionId}`);
      const badgeBalances = mostViewedBadgesDoc.badgePageVisits
        ? mostViewedBadgesDoc.badgePageVisits[`${mostViewed}` as keyof typeof mostViewedBadgesDoc.badgePageVisits]
        : [];
      const sortedBalances = badgeBalances.sort((a, b) => Number(b.amount) - Number(a.amount));
      return res.status(200).send({
        badgeIds: sortedBalances.map((x) => x.badgeIds).flat(),
        pagination: {
          bookmark: '',
          hasMore: false
        }
      });
    }

    // These uris will have the {id} placeholder
    const badgeMetadata = collection.getBadgeMetadataTimelineValue();
    const firstMatchesTimeline = BadgeMetadata.getFirstMatches(badgeMetadata ?? []);
    const currentMetadataUris = firstMatchesTimeline.map((x) => x.uri);

    const metadataQuery: any = {
      db: { $eq: 'Metadata' },
      $or: [
        {
          _docId: {
            $in: currentMetadataUris
          }
        },
        {
          _docId: {
            // replace {id} with any number and see if it matches
            $regex: `^${currentMetadataUris[0].replace('{id}', '[0-9]+')}$`
          }
        }
      ]
    };

    if (categories && categories.length > 0) {
      metadataQuery['content.category'] = {
        $in: categories
      };
    }

    if (tags && tags.length > 0) {
      metadataQuery['content.tags'] = {
        $elemMatch: {
          $in: tags
        }
      };
    }

    if (attributes && attributes.length > 0) {
      const elemMatches = attributes.map((attr) => ({
        'content.attributes': {
          $elemMatch: {
            name: { $eq: attr.name },
            value: { $eq: attr.value }
          }
        }
      }));

      metadataQuery.$and = elemMatches;
    }

    const paginationParams = await getQueryParamsFromBookmark(FetchModel, bookmark, false, '_id');
    const metadata = await findInDB(FetchModel, {
      query: { ...paginationParams, ...metadataQuery },
      limit: 25,
      sort: { _id: -1 }
    });
    const fetchedMatchingUris = metadata.map((doc) => doc._docId);

    const matchingBadgeIds = new UintRangeArray<bigint>();
    for (const uri of fetchedMatchingUris) {
      const metadataIds = getMetadataIdsForUri(uri, firstMatchesTimeline);
      for (const metadataId of metadataIds) {
        const badgeIds = getBadgeIdsForMetadataId(metadataId, firstMatchesTimeline);
        matchingBadgeIds.push(...badgeIds);
      }
    }
    const [, removed] = matchingBadgeIds.getOverlapDetails(UintRangeArray.From(badgeIds ?? []).convert(BigIntify));

    return res.status(200).send({
      badgeIds: removed.sortAndMerge(),
      pagination: {
        bookmark: metadata.length > 0 ? metadata[metadata.length - 1]._id?.toString() ?? '' : '',
        hasMore: metadata.length >= 25
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      message: `Error filtering badges in collection ${req.body.collectionId}.`
    });
  }
};
export const typiaError = async (res: Response<ErrorResponse>, typiaResponse: typia.IValidation<GetSearchPayload>) => {
  return res.status(400).json({
    errorMessage: `Invalid request payload. ${JSON.stringify(typiaResponse.errors)}`
  });
};

export const searchHandler = async (req: Request, res: Response<iGetSearchSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    typia.assert<string>(req.params.searchValue);
    const searchValue = req.params.searchValue.toString();
    const { noCollections, noAddressLists, noAccounts, specificCollectionId } = req.body as unknown as GetSearchPayload;

    const validateRes: typia.IValidation<GetSearchPayload> = typia.validate<GetSearchPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    if (!searchValue || searchValue.length === 0) {
      return res.json({
        collections: [],
        accounts: [],
        addressLists: [],
        badges: []
      });
    }

    // Search metadata of collections for matching names
    const metadataQuery = {
      'content.name': {
        $regex: `${searchValue}`,
        $options: 'i'
      },
      db: 'Metadata'
    };

    const usernameRes = noAccounts
      ? []
      : await findInDB(ProfileModel, {
          query: {
            username: {
              $eq: searchValue
            }
          },
          limit: 1
        });
    const cosmosAddresses = usernameRes.map((doc) => doc._docId);

    // All addresses should be alphanumeric only
    const sanitizedSearchValue = searchValue.replace(/[^a-zA-Z0-9]/g, '');
    const selectorCriteria: any[] = [
      { cosmosAddress: { $eq: cosmosAddresses[0] } },
      { ethAddress: { $regex: `(?i)${sanitizedSearchValue}` } },
      { solAddress: { $regex: `(?i)${sanitizedSearchValue}` } },
      { cosmosAddress: { $regex: `(?i)${sanitizedSearchValue}` } },
      { btcAddress: { $regex: `(?i)${sanitizedSearchValue}` } }
    ];

    const accountQuery = {
      $or: selectorCriteria
    };

    const addressListsQuery = {
      listId: { $regex: `(?i)${searchValue}` },
      private: { $ne: true }
    };

    const results = await Promise.all([
      noCollections && noAddressLists ? Promise.resolve([]) : findInDB(FetchModel, { query: metadataQuery, limit: 10 }),
      noAccounts ? Promise.resolve([]) : findInDB(AccountModel, { query: accountQuery, limit: 10 }),
      noAddressLists ? Promise.resolve([]) : findInDB(AddressListModel, { query: addressListsQuery, limit: 10 })

      // TODO: Fetch Solana accounts by regex from profiles DB? If they are not in the accounts DB, we can't fetch them
      // noAccounts ? Promise.resolve([]) : findInDB(AccountModel, { query: { solAddress: { $regex: `(?i)${searchValue}` } } })
    ]);

    const metadataResponseDocs = results[0].filter((doc) => doc._docId !== 'ipfs://Qmb1ysV3tyviTP2TytFgmnoQcuSvLRVbUEZJRCzekozjs2'); //filter placeholders
    const accountsResponseDocs = results[1];
    const addressListsResponseDocs = results[2];

    const allAccounts: Array<iAccountDoc<bigint> & { chain: SupportedChain }> = accountsResponseDocs.map((doc) => {
      // Can do more w/ guessing later (e.g. startsWiths and more)
      let chain = SupportedChain.COSMOS;
      if (searchValue.startsWith('0x')) {
        chain = SupportedChain.ETH;
      } else if (searchValue.startsWith('bc')) {
        chain = SupportedChain.BTC;
      } else if (searchValue.startsWith('cosm')) {
        chain = SupportedChain.COSMOS;
      } else if (doc.ethAddress.toLowerCase().includes(searchValue)) {
        chain = SupportedChain.ETH;
      } else if (doc.btcAddress.toLowerCase().includes(searchValue)) {
        chain = SupportedChain.BTC;
      } else if (doc.solAddress.toLowerCase().includes(searchValue)) {
        chain = SupportedChain.COSMOS;
      } else if (doc.cosmosAddress.toLowerCase().includes(searchValue)) {
        chain = SupportedChain.SOLANA;
      }

      return {
        ...doc,
        chain
      };
    });
    if (
      isAddressValid(searchValue) &&
      !accountsResponseDocs.find(
        (account) =>
          account.ethAddress === searchValue ||
          account.cosmosAddress === searchValue ||
          account.solAddress === searchValue ||
          account.btcAddress === searchValue
      )
    ) {
      const chain = getChainForAddress(searchValue);

      if (searchValue === 'Mint') allAccounts.push(BitBadgesUserInfo.MintAccount());
      else {
        allAccounts.push({
          _docId: convertToCosmosAddress(searchValue),
          btcAddress: convertToBtcAddress(convertToCosmosAddress(searchValue)),
          solAddress: chain === SupportedChain.SOLANA ? searchValue : '',
          ethAddress: convertToEthAddress(convertToCosmosAddress(searchValue)),
          cosmosAddress: convertToCosmosAddress(searchValue),
          chain: getChainForAddress(searchValue),
          publicKey: '',
          accountNumber: -1n,
          pubKeyType: ''
        });
      }
    }

    allAccounts.sort((a, b) => a.ethAddress.localeCompare(b.ethAddress));

    let uris = metadataResponseDocs.map((doc) => doc._docId);

    // Little hacky but we post process the placeholders IDs here if we can
    uris = uris
      .map((uri) => {
        // If any split of "/" can be parsed as an int, we replace it with {id}
        const split = uri.split('/');
        const urisToReturn = [uri];
        for (let i = 0; i < split.length; i++) {
          const x = split[i];
          if (x && Number.isInteger(Number(x))) {
            const copy = [...split];
            copy[i] = '{id}';
            urisToReturn.push(copy.join('/'));
          }
        }

        return urisToReturn;
      })
      .flat();

    const collectionsPromise = noCollections
      ? Promise.resolve([])
      : findInDB(CollectionModel, {
          query: {
            collectionId: specificCollectionId
              ? Number(specificCollectionId)
              : {
                  $exists: true
                },
            $or: [
              {
                collectionId: {
                  $eq: Number(searchValue)
                }
              },
              {
                collectionId: {
                  $eq: Number(specificCollectionId)
                }
              },
              {
                collectionMetadataTimeline: {
                  $elemMatch: {
                    'collectionMetadata.uri': {
                      $in: uris
                    }
                  }
                }
              },
              {
                badgeMetadataTimeline: {
                  $elemMatch: {
                    badgeMetadata: {
                      $elemMatch: {
                        // Need to handle regex for {id} placeholder
                        // The uris in uris do not have {id} placeholder. They are already replaced with the actual ID
                        uri: {
                          $in: uris
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        });

    const listsPromise = noAddressLists
      ? Promise.resolve([])
      : findInDB(AddressListModel, { query: { uri: { $in: uris }, private: { $ne: true } }, limit: 10 });

    const fetchKeys = allAccounts.map((account) => account.cosmosAddress);
    const fetchPromise = fetchKeys.length > 0 ? getManyFromDB(ProfileModel, fetchKeys) : Promise.resolve([]);

    const [_collectionsRes, _fetchRes, _listsRes] = await Promise.all([collectionsPromise, fetchPromise, listsPromise]);
    const collectionsRes = convertDocs(CollectionModel, _collectionsRes, BigIntify);
    const fetchRes = convertDocs(ProfileModel, _fetchRes, BigIntify);
    const listsRes = convertDocs(AddressListModel, _listsRes, BigIntify);

    const profileDocs = [];

    const docs = fetchRes;
    for (const account of allAccounts) {
      const doc = docs.find((doc) => doc && doc._docId === account.cosmosAddress);

      if (doc) {
        profileDocs.push(doc);
      } else {
        profileDocs.push({
          _docId: account.cosmosAddress
        });
      }
    }

    const collectionsResponsesPromise =
      collectionsRes.length === 0 || noCollections
        ? Promise.resolve([])
        : executeAdditionalCollectionQueries(
            req,
            res,
            collectionsRes,
            collectionsRes.map((doc) => {
              return {
                collectionId: doc.collectionId,
                fetchTotalAndMintBalances: true,
                metadataToFetch: {
                  uris,
                  badgeIds:
                    specificCollectionId && !isNaN(Number(searchValue))
                      ? [
                          {
                            start: BigInt(Math.floor(Number(searchValue))),
                            end: BigInt(Math.floor(Number(searchValue)))
                          }
                        ]
                      : undefined
                }
              };
            })
          );

    const convertToBitBadgesUserInfoPromise = noAccounts
      ? Promise.resolve([])
      : convertToBitBadgesUserInfo(req, res, profileDocs, allAccounts, true, []);

    const listsWithoutDuplicates = [...listsRes, ...addressListsResponseDocs].filter(
      (x, idx, self) => self.findIndex((y) => y.listId === x.listId) === idx
    );
    const addressListsToReturnPromise =
      noAddressLists || [...listsRes, ...addressListsResponseDocs].length === 0
        ? Promise.resolve([])
        : mustGetAddressListsFromDB(
            listsWithoutDuplicates.map((x) => {
              return {
                listId: x._docId
              };
            }),
            true,
            false,
            listsWithoutDuplicates
          );

    const [collectionsResponses, accounts, addressListsToReturn] = await Promise.all([
      collectionsResponsesPromise,
      convertToBitBadgesUserInfoPromise,
      addressListsToReturnPromise
    ]);

    let badges: Array<{
      collection: BitBadgesCollection<bigint>;
      badgeIds: UintRangeArray<bigint>;
    }> = [];
    for (const collection of collectionsResponses) {
      for (const timeline of collection.badgeMetadataTimeline) {
        for (const badgeMetadata of timeline.badgeMetadata) {
          if (uris.includes(badgeMetadata.uri)) {
            const existingIdx = badges.findIndex((x) => x.collection.collectionId === collection.collectionId);
            if (existingIdx !== -1) {
              badges[existingIdx].badgeIds.push(...badgeMetadata.badgeIds);
              badges[existingIdx].badgeIds.sortAndMerge();
            } else {
              badges.push({
                collection,
                badgeIds: badgeMetadata.badgeIds
              });
            }
          }
        }
      }
    }

    if (specificCollectionId) {
      // If specific collection ID and the value is a number, make sure we also return the badge with that ID
      const searchValNum = Number(searchValue);
      if (!isNaN(searchValNum)) {
        const badgeIdNum = BigInt(Math.floor(searchValNum));

        const collection = collectionsResponses.find((x) => BigInt(x.collectionId) === BigInt(specificCollectionId));
        if (collection) {
          if (collection.getMaxBadgeId() >= badgeIdNum) {
            // Push it as the first val in list
            const newBadges = {
              collection,
              badgeIds: UintRangeArray.From([{ start: badgeIdNum, end: badgeIdNum }])
            };
            for (const obj of badges) {
              const [remaining] = obj.badgeIds.getOverlapDetails([{ start: badgeIdNum, end: badgeIdNum }]);
              newBadges.badgeIds.push(...remaining);
            }

            badges = [newBadges];
          }
        }
      }
    }

    // Make sure no NSFW or reported stuff gets populated
    const result = {
      collections: collectionsResponses.filter((x) => {
        return (
          Number(x.collectionId) === Number(searchValue) ||
          Number(specificCollectionId) === Number(x.collectionId) ||
          x.collectionMetadataTimeline.find((timeline) => {
            return uris.includes(timeline.collectionMetadata.uri);
          })
        );
      }),
      accounts,
      addressLists: addressListsToReturn,
      badges: badges.map((x) => {
        return {
          collection: x.collection,
          badgeIds: x.badgeIds
        };
      })
    };

    const complianceDoc = await mustGetFromDB(ComplianceModel, 'compliance');
    // Make sure no NSFW or reported stuff gets populated
    result.collections = result.collections.filter(
      (x) => complianceDoc?.badges.reported?.some((y) => y.collectionId === BigInt(x.collectionId)) !== true
    );
    result.accounts = result.accounts.filter(
      (x) => complianceDoc?.accounts.reported?.some((y) => y.cosmosAddress === convertToCosmosAddress(x.address)) !== true
    );
    result.addressLists = result.addressLists.filter((x) => complianceDoc?.addressLists.reported?.some((y) => y.listId === x.listId) !== true);
    result.badges = result.badges.filter(
      (x) => complianceDoc?.badges.reported?.some((y) => y.collectionId === BigInt(x.collection.collectionId)) !== true
    );

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: `Error searching. Please try a different search value or try again later. ` + e.message
    });
  }
};
