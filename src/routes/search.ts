
import { JSPrimitiveNumberType, UintRange } from "bitbadgesjs-proto";
import { AccountInfo, BigIntify, BitBadgesCollection, GetSearchRouteResponse, MINT_ACCOUNT, NumberType, Stringify, SupportedChain, convertAddressMappingWithMetadata, convertBitBadgesCollection, convertBitBadgesUserInfo, convertToCosmosAddress, getChainForAddress, isAddressValid, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { ACCOUNTS_DB, ADDRESS_MAPPINGS_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { getAddressForName, getEnsResolver } from "../utils/ensResolvers";
import { executeAdditionalCollectionQueries } from "./collections";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { getAddressMappingsFromDB } from "./utils";
import { cosmosToEth } from "bitbadgesjs-utils";

export const searchHandler = async (req: Request, res: Response<GetSearchRouteResponse<NumberType>>) => {
  try {
    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
      return res.json({
        collections: [],
        accounts: [],
        addressMappings: [],
        badges: [],
      })
    }

    const ensToAttempt = searchValue.includes('.eth') ? searchValue : `${searchValue}.eth`;
    let resolvedEnsAddress = '';

    //We try even if it is a valid address, because an ENS name could be a valid address (e.g. 0x123...789.eth)
    try {
      const resolver = await getEnsResolver(ensToAttempt)
      if (resolver?.name) {
        resolvedEnsAddress = await getAddressForName(resolver.name);
      }
    } catch (e) {

    }

    // Search metadata of collections for matching names
    const collectionMetadataQuery: nano.MangoQuery = {
      selector: {
        content: {
          name: { "$regex": `(?i)${searchValue}` }
        },
        db: {
          "$eq": "Metadata"
        }
      },
    }

    const usernameRes = await PROFILES_DB.find({
      selector: {
        username: {
          "$regex": `(?i)${searchValue}`
        }
      }
    });

    const cosmosAddresses = usernameRes.docs.map((doc) => doc._id);

    const selectorCriteria: any[] = [
      { "ethAddress": { "$regex": `(?i)${searchValue}` } },
      { "solAddress": { "$regex": `(?i)${searchValue}` } },
      { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
      { "cosmosAddress": { "$in": cosmosAddresses } },
    ];



    if (resolvedEnsAddress) {
      selectorCriteria.push({ "ethAddress": { "$regex": `(?i)${resolvedEnsAddress}` } });
    }

    const accountQuery = {
      selector: {
        "$or": selectorCriteria,
      },
    }



    const addressMappingsQuery = {
      selector: {
        mappingId: { "$regex": `(?i)${searchValue}` }
      }
    }

    const results = await Promise.all([
      FETCHES_DB.find(collectionMetadataQuery),
      ACCOUNTS_DB.find(accountQuery),
      ADDRESS_MAPPINGS_DB.find(addressMappingsQuery),
    ]);

    const metadataResponseDocs = results[0].docs;
    const accountsResponseDocs = results[1].docs;
    const addressMappingsResponseDocs = results[2].docs;


    const allAccounts: AccountInfo<JSPrimitiveNumberType>[] = [...accountsResponseDocs.map(removeCouchDBDetails)];
    if (isAddressValid(searchValue)
      && !accountsResponseDocs.find((account) => account.ethAddress === searchValue || account.cosmosAddress === searchValue || account.solAddress === searchValue)) {
      const chain = getChainForAddress(searchValue);

      if (searchValue === 'Mint') allAccounts.push(convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify));
      else allAccounts.push({
        _id: convertToCosmosAddress(searchValue),

        solAddress: chain === SupportedChain.SOLANA ? searchValue : '',
        ethAddress: cosmosToEth(convertToCosmosAddress(searchValue)),
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
        publicKey: '',
        accountNumber: '-1',
      });
    }

    if (resolvedEnsAddress
      && !accountsResponseDocs.find((account) => account.ethAddress === resolvedEnsAddress || account.cosmosAddress === resolvedEnsAddress || account.solAddress === resolvedEnsAddress)) {
      allAccounts.push({
        _id: convertToCosmosAddress(resolvedEnsAddress),
        ethAddress: resolvedEnsAddress,
        solAddress: '',
        cosmosAddress: convertToCosmosAddress(resolvedEnsAddress),
        chain: getChainForAddress(resolvedEnsAddress),
        publicKey: '',
        accountNumber: '-1',
      });
    }

    allAccounts.sort((a, b) => a.ethAddress.localeCompare(b.ethAddress));

    let uris = metadataResponseDocs.map((doc) => doc._id);

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


    const collectionsPromise = COLLECTIONS_DB.find({
      selector: {
        "$or": [
          {
            collectionId: {
              "$eq": Number(searchValue)
            },
          },
          {
            collectionMetadataTimeline: {
              "$elemMatch": {
                collectionMetadata: {
                  //This is fine bc collection metadata never has {id} placeholder
                  uri: {
                    "$in": uris
                  }
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
      }
    });

    const fetchKeys = allAccounts.map(account => account.cosmosAddress);
    const fetchPromise = fetchKeys.length ? PROFILES_DB.fetch({ keys: fetchKeys }, { include_docs: true }) : Promise.resolve({ rows: [], offset: 0, total_rows: 0 });

    const [collectionsRes, fetchRes] = await Promise.all([collectionsPromise, fetchPromise]);


    const profileDocs = [];

    const docs = getDocsFromNanoFetchRes(fetchRes, true);
    for (const account of allAccounts) {
      const doc = docs.find((doc) => doc._id === account.cosmosAddress);
      if (doc) {
        profileDocs.push(doc);
      } else {
        profileDocs.push({})
      }
    }


    const collectionsResponsesPromise = executeAdditionalCollectionQueries(
      req,
      collectionsRes.docs,
      collectionsRes.docs.map((doc) => {
        return { collectionId: doc.collectionId, metadataToFetch: { uris: uris } };
      })
    );

    const convertToBitBadgesUserInfoPromise = convertToBitBadgesUserInfo(profileDocs, allAccounts);

    const addressMappingsToReturnPromise = getAddressMappingsFromDB(
      addressMappingsResponseDocs.map(x => {
        return {
          mappingId: x._id,
        };
      }),
      true
    );

    const [collectionsResponses, accounts, addressMappingsToReturn] = await Promise.all([
      collectionsResponsesPromise,
      convertToBitBadgesUserInfoPromise,
      addressMappingsToReturnPromise
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

    return res.json({
      collections: collectionsResponses.filter((x) => {
        return Number(x.collectionId) === Number(searchValue) || x.collectionMetadataTimeline.find((timeline) => {
          return uris.includes(timeline.collectionMetadata.uri);
        })
      }).map((x) => removeCouchDBDetails(x)),
      accounts,
      addressMappings: addressMappingsToReturn.map(x => convertAddressMappingWithMetadata(x, Stringify)),
      badges: badges.map((x) => {
        return {
          collection: removeCouchDBDetails(x.collection),
          badgeIds: x.badgeIds,
        }
      })
    })
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      message: `Error searching for ${req.params.searchValue}. Please try a different search value or try again later.`
    })
  }
}
