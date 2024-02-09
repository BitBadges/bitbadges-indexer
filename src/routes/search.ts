
import { JSPrimitiveNumberType, UintRange, convertBadgeMetadataTimeline, convertUintRange } from "bitbadgesjs-sdk";
import { AccountDoc, BigIntify, BitBadgesCollection, FilterBadgesInCollectionRequestBody, GetSearchRouteRequestBody, GetSearchRouteResponse, MINT_ACCOUNT, NumberType, Stringify, SupportedChain, convertBitBadgesAddressList, convertBitBadgesCollection, convertBitBadgesUserInfo, convertToCosmosAddress, cosmosToBtc, cosmosToEth, getBadgeIdsForMetadataId, getChainForAddress, getCurrentValueForTimeline, getFirstMatchForBadgeMetadata, getMaxBadgeIdForCollection, getMetadataIdsForUri, isAddressValid, removeUintRangesFromUintRanges, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-sdk";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AccountModel, AddressListModel, CollectionModel, FetchModel, PageVisitsModel, ProfileModel, getManyFromDB, mustGetFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { getAddressForName } from "../utils/ensResolvers";
import { executeAdditionalCollectionQueries } from "./collections";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { getAddressListsFromDB } from "./utils";
import { getQueryParamsFromBookmark } from "./activityHelpers";

export const filterBadgesInCollectionHandler = async (req: Request, res: Response) => {
  try {
    const { categories, collectionId, tags, badgeIds, mostViewed, bookmark } = req.body as FilterBadgesInCollectionRequestBody

    const collection = await CollectionModel.findOne({
      collectionId: Number(collectionId),
    }).lean().exec();
    if (!collection) {
      throw `Error getting collection ID ${collectionId}`
    }

    //This is a special view incompatible with the others
    if (mostViewed) {
      const mostViewedBadgesDoc = await mustGetFromDB(PageVisitsModel, `${collectionId}`);
      const badgeBalances = mostViewedBadgesDoc.badgePageVisits ? mostViewedBadgesDoc.badgePageVisits[`${mostViewed}` as keyof typeof mostViewedBadgesDoc.badgePageVisits] : [];
      const sortedBalances = badgeBalances.sort((a, b) => Number(b.amount) - Number(a.amount));
      return res.status(200).send({
        badgeIds: sortedBalances.map(x => x.badgeIds).flat(),
        pagination: {
          bookmark: '',
          hasMore: false,
        }
      });
    }


    //These uris will have the {id} placeholder
    const currTimeline = getCurrentValueForTimeline(collection.badgeMetadataTimeline.map(x => convertBadgeMetadataTimeline(x, BigIntify)) ?? []);
    const firstMatchesTimeline = getFirstMatchForBadgeMetadata(currTimeline?.badgeMetadata ?? []);
    const currentMetadataUris = firstMatchesTimeline.map((x) => x.uri);

    const metadataQuery: any = {

      db: "Metadata",
      $or: [{
        _docId: {
          "$in": currentMetadataUris
        }
      }, {
        _docId: {
          //replace {id} with any number and see if it matches
          "$regex": `^${currentMetadataUris[0].replace('{id}', '[0-9]+')}$`
        }
      }]
    }

    if (categories && categories.length > 0) {
      metadataQuery["content.category"] = {
        "$in": categories
      }
    }

    if (tags && tags.length > 0) {
      metadataQuery["content.tags"] = {
        "$elemMatch": {
          "$in": tags
        }
      }
    }

    const paginationParams = await getQueryParamsFromBookmark(FetchModel, bookmark, false, '_id');
    const metadata = await FetchModel.find({
      ...paginationParams,
      ...metadataQuery
    }).lean().limit(25).sort({
      _id: -1
    }).exec();

    const fetchedMatchingUris = metadata.map((doc) => doc._docId);

    const matchingBadgeIds: UintRange<bigint>[] = [];
    for (const uri of fetchedMatchingUris) {
      const metadataIds = getMetadataIdsForUri(uri, firstMatchesTimeline);
      for (const metadataId of metadataIds) {
        const badgeIds = getBadgeIdsForMetadataId(metadataId, firstMatchesTimeline);
        matchingBadgeIds.push(...badgeIds);
      }
    }

    const [_, removed] = removeUintRangesFromUintRanges(badgeIds?.map(x => convertUintRange(x, BigIntify)) ?? [], matchingBadgeIds);

    return res.status(200).send({
      badgeIds: sortUintRangesAndMergeIfNecessary(removed, true),
      pagination: {
        bookmark: metadata.length > 0 ? metadata[metadata.length - 1]._id.toString() : '',
        hasMore: metadata.length >= 25,
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      message: `Error filtering badges in collection ${req.body.collectionId}. Please try again later.`
    })
  }

}

export const searchHandler = async (req: Request, res: Response<GetSearchRouteResponse<NumberType>>) => {
  try {
    const searchValue = req.params.searchValue;
    const { noCollections, noAddressLists, noAccounts, specificCollectionId } = req.body as GetSearchRouteRequestBody;


    if (!searchValue || searchValue.length == 0) {
      return res.json({
        collections: [],
        accounts: [],
        addressLists: [],
        badges: [],
      })
    }

    const ensToAttempt = searchValue.includes('.eth') ? searchValue : `${searchValue}.eth`;
    let resolvedEnsAddress = '';

    //We try even if it is a valid address, because an ENS name could be a valid address (e.g. 0x123...789.eth)
    try {
      if (!noAccounts) resolvedEnsAddress = await getAddressForName(ensToAttempt);
    } catch (e) {

    }

    // Search metadata of collections for matching names
    const metadataQuery = {
      ["content.name"]: {
        "$regex": `${searchValue}`,
        "$options": "i"
      },
      db: "Metadata"
    }

    const usernameRes = noAccounts ? [] : await ProfileModel.find({
      username: {
        "$regex": `(?i)${searchValue}`
      }
    }).lean().exec();

    const cosmosAddresses = usernameRes.map((doc) => doc._docId);

    const selectorCriteria: any[] = [
      { "cosmosAddress": { "$in": cosmosAddresses } },
      { "ethAddress": { "$regex": `(?i)${searchValue}` } },
      { "solAddress": { "$regex": `(?i)${searchValue}` } },
      { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
      { "btcAddress": { "$regex": `(?i)${searchValue}` } },
    ];

    if (resolvedEnsAddress) {
      selectorCriteria.push({ "ethAddress": resolvedEnsAddress });
    }

    const accountQuery = {
      "$or": selectorCriteria,
    }

    const addressListsQuery = {
      listId: { "$regex": `(?i)${searchValue}` },
      private: { "$ne": true }
    }

    const results = await Promise.all([
      noCollections && noAddressLists ? Promise.resolve([]) : FetchModel.find(metadataQuery).limit(10).lean().exec(),
      noAccounts ? Promise.resolve([]) : AccountModel.find(accountQuery).limit(10).lean().exec(),
      noAddressLists ? Promise.resolve([]) : AddressListModel.find(addressListsQuery).limit(10).lean().exec(),
    ]);

    const metadataResponseDocs = results[0];
    const accountsResponseDocs = results[1];
    const addressListsResponseDocs = results[2];


    const allAccounts: (AccountDoc<JSPrimitiveNumberType> & { chain: SupportedChain })[] = accountsResponseDocs.map((doc) => {
      //Can do more w/ guessing later (e.g. startsWiths and more)
      const regex = new RegExp(`${searchValue}`, 'i');
      let chain = SupportedChain.COSMOS;
      if (searchValue.startsWith('0x')) {
        chain = SupportedChain.ETH;
      } else if (searchValue.startsWith('bc')) {
        chain = SupportedChain.BTC;
      } else if (searchValue.startsWith('cosm')) {
        chain = SupportedChain.COSMOS;
      } else if (regex.test(doc.ethAddress)) {
        chain = SupportedChain.ETH;
      } else if (regex.test(doc.btcAddress)) {
        chain = SupportedChain.BTC;
      } else if (regex.test(doc.cosmosAddress)) {
        chain = SupportedChain.COSMOS;
      } else if (regex.test(doc.solAddress)) {
        chain = SupportedChain.SOLANA;
      }

      return {
        ...doc,
        chain
      }
    });
    if (isAddressValid(searchValue)
      && !accountsResponseDocs.find((account) => account.ethAddress === searchValue || account.cosmosAddress === searchValue || account.solAddress === searchValue || account.btcAddress === searchValue)) {
      const chain = getChainForAddress(searchValue);

      if (searchValue === 'Mint') allAccounts.push({ ...convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify), _docId: MINT_ACCOUNT.cosmosAddress });
      else allAccounts.push({
        _docId: convertToCosmosAddress(searchValue),
        btcAddress: cosmosToBtc(convertToCosmosAddress(searchValue)),
        solAddress: chain === SupportedChain.SOLANA ? searchValue : '',
        ethAddress: cosmosToEth(convertToCosmosAddress(searchValue)),
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
        publicKey: '',
        accountNumber: '-1',
        pubKeyType: '',
      });
    }

    if (resolvedEnsAddress
      && !accountsResponseDocs.find((account) => account.ethAddress === resolvedEnsAddress || account.cosmosAddress === resolvedEnsAddress || account.solAddress === resolvedEnsAddress || account.btcAddress === resolvedEnsAddress)) {
      allAccounts.push({
        _docId: convertToCosmosAddress(resolvedEnsAddress),
        ethAddress: resolvedEnsAddress,
        btcAddress: cosmosToBtc(convertToCosmosAddress(resolvedEnsAddress)),
        solAddress: '',
        cosmosAddress: convertToCosmosAddress(resolvedEnsAddress),
        chain: getChainForAddress(resolvedEnsAddress),
        publicKey: '',
        accountNumber: '-1',
        pubKeyType: '',
      });
    }

    allAccounts.sort((a, b) => a.ethAddress.localeCompare(b.ethAddress));

    let uris = metadataResponseDocs.map((doc) => doc._docId);

    //Little hacky but we post process the placeholders IDs here if we can
    uris = uris.map((uri) => {
      //If any split of "/" can be parsed as an int, we replace it with {id}
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
    }).flat();


    const collectionsPromise = noCollections ? Promise.resolve([]) :
      CollectionModel.find({
        collectionId: specificCollectionId ? Number(specificCollectionId) : {
          "$exists": true
        },
        "$or": [
          {
            collectionId: {
              "$eq": Number(searchValue)
            },
          },
          {
            collectionId: {
              "$eq": Number(specificCollectionId)
            },
          },
          {
            collectionMetadataTimeline: {
              "$elemMatch": {
                ["collectionMetadata.uri"]: {
                  "$in": uris
                }
              }
            }
          },
          {
            badgeMetadataTimeline: {
              "$elemMatch": {
                badgeMetadata: {
                  "$elemMatch": {
                    //Need to handle regex for {id} placeholder
                    //The uris in uris do not have {id} placeholder. They are already replaced with the actual ID
                    uri: {
                      "$in": uris
                    }
                  }
                }
              }
            }
          }
        ]
      }).lean().exec();

    const listsPromise = noAddressLists ? Promise.resolve([]) :
      AddressListModel.find({
        uri: { "$in": uris },
      }).lean().exec();



    const fetchKeys = allAccounts.map(account => account.cosmosAddress);
    const fetchPromise = fetchKeys.length ? getManyFromDB(ProfileModel, fetchKeys) : Promise.resolve([]);


    const [collectionsRes, fetchRes, listsRes] = await Promise.all([collectionsPromise, fetchPromise, listsPromise]);

    const profileDocs = [];

    const docs = fetchRes;
    for (const account of allAccounts) {
      const doc = docs.find((doc) => doc && doc._docId === account.cosmosAddress);
      if (doc) {
        profileDocs.push(doc);
      } else {
        profileDocs.push({
          _docId: account.cosmosAddress,
        })
      }
    }

    const collectionsResponsesPromise =
      collectionsRes.length === 0 ? Promise.resolve([]) : executeAdditionalCollectionQueries(
        req,
        collectionsRes,
        collectionsRes.map((doc) => {
          return {
            collectionId: doc.collectionId, metadataToFetch: {
              uris: uris,
              badgeIds: specificCollectionId && !isNaN(Number(searchValue))

                ? [{
                  start: BigInt(Math.floor(Number(searchValue))),
                  end: BigInt(Math.floor(Number(searchValue))),
                }] : undefined,
            },
          };
        })
      );

    const convertToBitBadgesUserInfoPromise =
      noAccounts ? Promise.resolve([]) :
        convertToBitBadgesUserInfo(profileDocs, allAccounts);

    const addressListsToReturnPromise =
      [...listsRes, ...addressListsResponseDocs].length === 0 ? Promise.resolve([]) : getAddressListsFromDB(
        [...listsRes, ...addressListsResponseDocs].map(x => {
          return {
            listId: x._docId,
          };
        }),
        true
      );

    const [collectionsResponses, accounts, addressListsToReturn] = await Promise.all([
      collectionsResponsesPromise,
      convertToBitBadgesUserInfoPromise,
      addressListsToReturnPromise
    ]);

    let badges: {
      collection: BitBadgesCollection<bigint>,
      badgeIds: UintRange<bigint>[]
    }[] = [];
    for (let _collection of collectionsResponses) {
      const collection = convertBitBadgesCollection(_collection, BigIntify);
      for (const timeline of collection.badgeMetadataTimeline) {
        for (const badgeMetadata of timeline.badgeMetadata) {
          if (uris.includes(badgeMetadata.uri)) {
            const existingIdx = badges.findIndex((x) => x.collection.collectionId === collection.collectionId);
            if (existingIdx !== -1) {
              badges[existingIdx].badgeIds.push(...badgeMetadata.badgeIds);
              badges[existingIdx].badgeIds = sortUintRangesAndMergeIfNecessary(badges[existingIdx].badgeIds, true)
            } else {
              badges.push({
                collection: collection,
                badgeIds: badgeMetadata.badgeIds
              });
            }
          }
        }
      }
    }

    if (specificCollectionId) {
      //If specific collection ID and the value is a number, make sure we also return the badge with that ID
      const searchValNum = Number(searchValue);
      if (!isNaN(searchValNum)) {
        const badgeIdNum = BigInt(Math.floor(searchValNum));

        const collection = collectionsResponses.find((x) => BigInt(x.collectionId) === BigInt(specificCollectionId));
        if (collection) {
          if (getMaxBadgeIdForCollection(convertBitBadgesCollection(collection, BigIntify)) >= badgeIdNum) {
            //Push it as the first val in list
            const newBadges = {
              collection: convertBitBadgesCollection(collection, BigIntify),
              badgeIds: [convertUintRange({
                start: badgeIdNum,
                end: badgeIdNum,
              }, BigIntify)]
            };
            for (const obj of badges) {
              const [remaining] = removeUintRangesFromUintRanges([convertUintRange({
                start: badgeIdNum,
                end: badgeIdNum,
              }, BigIntify)], obj.badgeIds);

              newBadges.badgeIds.push(...remaining);
            }

            badges = [newBadges];
          }
        }
      }
    }

    //Make sure no NSFW or reported stuff gets populated
    let result = {
      collections: collectionsResponses.filter((x) => {
        return Number(x.collectionId) === Number(searchValue) ||
          Number(specificCollectionId) === Number(x.collectionId) ||
          x.collectionMetadataTimeline.find((timeline) => {
            return uris.includes(timeline.collectionMetadata.uri);
          })
      }),
      accounts,
      addressLists: addressListsToReturn.map(x => convertBitBadgesAddressList(x, Stringify)),
      badges: badges.map((x) => {
        return {
          collection: x.collection,
          badgeIds: x.badgeIds,
        }
      })
    }

    //Make sure no NSFW or reported stuff gets populated
    result.collections = result.collections.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collectionId)) !== true);
    result.accounts = result.accounts.filter(x => complianceDoc?.accounts.reported?.some(y => y.cosmosAddress === convertToCosmosAddress(x.address)) !== true);
    result.addressLists = result.addressLists.filter(x => complianceDoc?.addressLists.reported?.some(y => y.listId === x.listId) !== true);
    result.badges = result.badges.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collection.collectionId)) !== true);

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      errorMessage: `Error searching for ${req.params.searchValue}. Please try a different search value or try again later.`
    })
  }
}
