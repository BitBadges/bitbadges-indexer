
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfo, AddressMappingWithMetadata, GetSearchRouteResponse, MINT_ACCOUNT, Metadata, NumberType, Stringify, convertBitBadgesUserInfo, convertMetadata, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { ACCOUNTS_DB, ADDRESS_MAPPINGS_DB, COLLECTIONS_DB, FETCHES_DB } from "../db/db";
import { getAddressForName, getEnsResolver } from "../utils/ensResolvers";
import { executeAdditionalCollectionQueries } from "./collections";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { catch404, removeCouchDBDetails } from "../utils/couchdb-utils";

export const searchHandler = async (req: Request, res: Response<GetSearchRouteResponse<NumberType>>) => {
  try {
    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
      return res.json({
        collections: [],
        accounts: [],
        addressMappings: [],
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

    const selectorCriteria: any[] = [
      { "address": { "$regex": `(?i)${searchValue}` } },
      // { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
      // { "_id": { "$regex": `(?i)${convertToCosmosAddress(searchValue)}:` } },
      { "username": { "$regex": `(?i)${searchValue}` } }
    ];

    if (resolvedEnsAddress) {
      selectorCriteria.push({ "address": { "$regex": `(?i)${resolvedEnsAddress}` } });
      // selectorCriteria.push({ "cosmosAddress": { "$regex": `(?i)${resolvedEnsAddress}` } });
    }

    // if (searchValue.startsWith('cosmos')) {
    //   selectorCriteria.push({ "cosmosAddress": { "$regex": `(?i)${searchValue}` } });
    // }

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
      && !accountsResponseDocs.find((account) => account.address === searchValue || account.cosmosAddress === searchValue)) {
      if (searchValue === 'Mint') allAccounts.push(convertBitBadgesUserInfo(MINT_ACCOUNT, Stringify));
      else allAccounts.push({
        _id: convertToCosmosAddress(searchValue),
        address: searchValue,
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
        publicKey: '',
        accountNumber: '-1',
      });
    }

    if (resolvedEnsAddress
      && !accountsResponseDocs.find((account) => account.address === resolvedEnsAddress || account.cosmosAddress === resolvedEnsAddress)) {
      allAccounts.push({
        _id: convertToCosmosAddress(resolvedEnsAddress),
        address: resolvedEnsAddress,
        cosmosAddress: convertToCosmosAddress(resolvedEnsAddress),
        chain: getChainForAddress(resolvedEnsAddress),
        publicKey: '',
        accountNumber: '-1',
      });
    }

    allAccounts.sort((a, b) => a.address.localeCompare(b.address));

    const uris = metadataResponseDocs.map((doc) => doc._id);
    const collectionsRes = await COLLECTIONS_DB.find({
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
                  uri: {
                    "$in": uris
                  }
                }
              }
            }
          },
          {
            badgeUris: {
              "$elemMatch": {
                badgeMetadata: {
                  "$elemMatch": {
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

    const collectionsResponses = await executeAdditionalCollectionQueries(req, collectionsRes.docs, collectionsRes.docs.map((doc) => {
      return { collectionId: doc.collectionId };
    }));

    const accounts = (await convertToBitBadgesUserInfo(allAccounts.map(() => { return {} }), allAccounts)).map((account) => convertBitBadgesUserInfo(account, Stringify));


    let addressMappingsToReturn: AddressMappingWithMetadata<string>[] = [...addressMappingsResponseDocs.map(x => removeCouchDBDetails(x))];
    let mappingUris: string[] = addressMappingsToReturn.map(x => x.uri);
    if (mappingUris.length > 0) {
      for (const uri of mappingUris) {
        const doc = await FETCHES_DB.get(uri).catch(catch404);
        if (doc) {
          addressMappingsToReturn = addressMappingsToReturn.map(x => {
            if (x.uri === uri) {
              return {
                ...x,
                metadata: convertMetadata(doc.content as Metadata<JSPrimitiveNumberType>, Stringify),
              }
            } else {
              return x;
            }
          })
        }
      }
    }


    return res.json({
      collections: collectionsResponses,
      accounts,
      addressMappings: addressMappingsToReturn,
    })
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      message: `Error searching for ${req.params.searchValue}. Please try a different search value or try again later.`
    })
  }
}
