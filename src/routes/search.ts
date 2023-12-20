
import { JSPrimitiveNumberType, UintRange } from "bitbadgesjs-proto";
import { AccountDoc, BigIntify, BitBadgesCollection, GetSearchRouteRequestBody, GetSearchRouteResponse, MINT_ACCOUNT, NumberType, Stringify, SupportedChain, convertAddressMappingWithMetadata, convertBitBadgesCollection, convertBitBadgesUserInfo, convertToCosmosAddress, cosmosToEth, getChainForAddress, isAddressValid, sortUintRangesAndMergeIfNecessary } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AccountModel, AddressMappingModel, CollectionModel, FetchModel, ProfileModel, getManyFromDB } from "../db/db";
import { getAddressForName } from "../utils/ensResolvers";
import { executeAdditionalCollectionQueries } from "./collections";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { getAddressMappingsFromDB } from "./utils";
import { complianceDoc } from "../poll";

export const searchHandler = async (req: Request, res: Response<GetSearchRouteResponse<NumberType>>) => {
  try {
    const searchValue = req.params.searchValue;
    const { noCollections, noAddressMappings, noAccounts } = req.body as GetSearchRouteRequestBody;

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
      if (!noAccounts) resolvedEnsAddress = await getAddressForName(ensToAttempt);
    } catch (e) {

    }

    // Search metadata of collections for matching names
    const collectionMetadataQuery = {
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

    const cosmosAddresses = usernameRes.map((doc) => doc._legacyId);

    const selectorCriteria: any[] = [
      { "cosmosAddress": { "$in": cosmosAddresses } },
      { "ethAddress": { "$regex": `(?i)${searchValue}` } },
      { "solAddress": { "$regex": `(?i)${searchValue}` } },
      { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
    ];

    if (resolvedEnsAddress) {
      selectorCriteria.push({ "ethAddress": resolvedEnsAddress });
    }

    const accountQuery = {
      "$or": selectorCriteria,
    }

    const addressMappingsQuery = {
      mappingId: { "$regex": `(?i)${searchValue}` },
      private: { "$ne": true }
    }

    const results = await Promise.all([
      noCollections ? Promise.resolve([]) : FetchModel.find(collectionMetadataQuery).limit(10).lean().exec(),
      noAccounts ? Promise.resolve([]) : AccountModel.find(accountQuery).limit(10).lean().exec(),
      noAddressMappings ? Promise.resolve([]) : AddressMappingModel.find(addressMappingsQuery).limit(10).lean().exec(),
    ]);

    const metadataResponseDocs = results[0];
    const accountsResponseDocs = results[1];
    const addressMappingsResponseDocs = results[2];


    const allAccounts: AccountDoc<JSPrimitiveNumberType>[] = [...accountsResponseDocs];
    if (isAddressValid(searchValue)
      && !accountsResponseDocs.find((account) => account.ethAddress === searchValue || account.cosmosAddress === searchValue || account.solAddress === searchValue)) {
      const chain = getChainForAddress(searchValue);

      if (searchValue === 'Mint') allAccounts.push({ ...convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify), _legacyId: MINT_ACCOUNT.cosmosAddress });
      else allAccounts.push({
        _legacyId: convertToCosmosAddress(searchValue),

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
        _legacyId: convertToCosmosAddress(resolvedEnsAddress),
        ethAddress: resolvedEnsAddress,
        solAddress: '',
        cosmosAddress: convertToCosmosAddress(resolvedEnsAddress),
        chain: getChainForAddress(resolvedEnsAddress),
        publicKey: '',
        accountNumber: '-1',
      });
    }

    allAccounts.sort((a, b) => a.ethAddress.localeCompare(b.ethAddress));

    let uris = metadataResponseDocs.map((doc) => doc._legacyId);

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
        "$or": [
          {
            collectionId: {
              "$eq": Number(searchValue)
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

    const fetchKeys = allAccounts.map(account => account.cosmosAddress);
    const fetchPromise = fetchKeys.length ? getManyFromDB(ProfileModel, fetchKeys) : Promise.resolve([]);


    const [collectionsRes, fetchRes] = await Promise.all([collectionsPromise, fetchPromise]);

    const profileDocs = [];

    const docs = fetchRes;
    for (const account of allAccounts) {
      const doc = docs.find((doc) => doc && doc._legacyId === account.cosmosAddress);
      if (doc) {
        profileDocs.push(doc);
      } else {
        profileDocs.push({
          _legacyId: account.cosmosAddress,
        })
      }
    }


    const collectionsResponsesPromise =
      collectionsRes.length === 0 ? Promise.resolve([]) : executeAdditionalCollectionQueries(
        req,
        collectionsRes,
        collectionsRes.map((doc) => {
          return { collectionId: doc.collectionId, metadataToFetch: { uris: uris } };
        })
      );

    const convertToBitBadgesUserInfoPromise =
      noAccounts ? Promise.resolve([]) :
        convertToBitBadgesUserInfo(profileDocs, allAccounts);

    const addressMappingsToReturnPromise =
      addressMappingsResponseDocs.length === 0 ? Promise.resolve([]) : getAddressMappingsFromDB(
        addressMappingsResponseDocs.map(x => {
          return {
            mappingId: x._legacyId,
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

    //Make sure no NSFW or reported stuff gets populated
    let result = {
      collections: collectionsResponses.filter((x) => {
        return Number(x.collectionId) === Number(searchValue) || x.collectionMetadataTimeline.find((timeline) => {
          return uris.includes(timeline.collectionMetadata.uri);
        })
      }),
      accounts,
      addressMappings: addressMappingsToReturn.map(x => convertAddressMappingWithMetadata(x, Stringify)),
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
    result.addressMappings = result.addressMappings.filter(x => complianceDoc?.addressMappings.reported?.some(y => y.mappingId === x.mappingId) !== true);
    result.badges = result.badges.filter(x => complianceDoc?.badges.reported?.some(y => y.collectionId === BigInt(x.collection.collectionId)) !== true);

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      message: `Error searching for ${req.params.searchValue}. Please try a different search value or try again later.`
    })
  }
}
