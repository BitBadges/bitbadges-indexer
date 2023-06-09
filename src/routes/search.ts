
import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, BitBadgesUserInfo, GetSearchRouteResponse, NumberType, Stringify, convertBitBadgesUserInfo, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { getDocsFromNanoFetchRes } from "../utils/couchdb-utils";
import { ACCOUNTS_DB, COLLECTIONS_DB, FETCHES_DB, PROFILES_DB } from "../db/db";
import { getAddressForName, getEnsResolver } from "../utils/ensResolvers";
import { convertToBitBadgesUserInfo } from "./userHelpers";
import { executeAdditionalCollectionQueries } from "./collections";

export const searchHandler = async (req: Request, res: Response<GetSearchRouteResponse<NumberType>>) => {
  try {
    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
      return res.json({
        collections: [],
        accounts: [],
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

    const accountQuery = {
      selector: {
        "$or": [
          { "address": { "$regex": `(?i)${resolvedEnsAddress}` } },
          { "cosmosAddress": { "$regex": `(?i)${resolvedEnsAddress}` } },
          { "address": { "$regex": `(?i)${searchValue}` } },
          { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
          { "_id": { "$regex": `(?i)${convertToCosmosAddress(searchValue)}:` } },
          { "username": { "$regex": `(?i)${searchValue}` } },
        ]
      },
    }


    const results = await Promise.all([
      FETCHES_DB.find(collectionMetadataQuery),
      ACCOUNTS_DB.find(accountQuery),
    ]);

    const metadataResponseDocs = results[0].docs;
    const accountsResponseDocs = results[1].docs;

    const allAccounts: AccountInfoBase<JSPrimitiveNumberType>[] = [];
    if (isAddressValid(searchValue)
      && !accountsResponseDocs.find((account) => account.address === searchValue || account.cosmosAddress === searchValue)) {
      allAccounts.push({
        address: searchValue,
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
        publicKey: '',
      });
    }

    const profilesRes = await PROFILES_DB.fetch({ keys: allAccounts.map((account) => account.cosmosAddress) }, { include_docs: true });
    const profilesResponseDocs = getDocsFromNanoFetchRes(profilesRes);

    const allProfiles = [...profilesResponseDocs];

    allAccounts.sort((a, b) => a.address.localeCompare(b.address));
    allProfiles.sort((a, b) => a._id.localeCompare(b._id));

    const accounts: BitBadgesUserInfo<JSPrimitiveNumberType>[] = await convertToBitBadgesUserInfo(allProfiles, allAccounts);

    const uris = metadataResponseDocs.map((doc) => doc._id);
    const collectionsRes = await COLLECTIONS_DB.find({
      selector: {
        "$or": [
          {
            collectionUri: {
              "$in": uris
            }
          },
          {
            badgeUris: {
              "$elemMatch": {
                "$in": uris
              }
            }
          }
        ]
      }
    });

    const collectionsResponses = await executeAdditionalCollectionQueries(collectionsRes.docs, collectionsRes.docs.map((doc) => {
      return { collectionId: doc._id }
    }));

    return res.json({
      collections: collectionsResponses,
      accounts: accounts.map(acc => convertBitBadgesUserInfo(acc, Stringify)),
    })
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: serializeError(e),
      message: `Error searching for ${req.params.searchValue}. Please try a different search value or try again later.`
    })
  }
}
