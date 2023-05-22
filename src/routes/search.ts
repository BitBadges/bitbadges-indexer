
import { BitBadgesUserInfo, Metadata, convertToCosmosAddress, getChainForAddress, isAddressValid, s_Account, s_BitBadgesUserInfo, s_Profile } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, METADATA_DB, PROFILES_DB } from "../db/db";
import { getAddressForName, getEnsResolver } from "../utils/ensResolvers";
import { convertToBitBadgesUserInfo } from "./userHelpers";

export const searchHandler = async (req: Request, res: Response) => {
  try {
    const searchResponse: {
      collections: Metadata[],
      accounts: BitBadgesUserInfo[],
    } = {
      collections: [],
      accounts: [],
    }

    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
      return res.json(searchResponse)
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
        "isCollection": true,
        "$or": [
          { "name": { "$regex": `(?i)${searchValue}` } },
          { "_id": { "$regex": `(?i)${searchValue}:` } },
        ]
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
        ]
      },
    }

    const usernameQuery = {
      selector: {
        "$or": [
          { "username": { "$regex": `(?i)${searchValue}` } },
        ]
      },
    }




    const results = await Promise.all([
      METADATA_DB.find(collectionMetadataQuery),
      ACCOUNTS_DB.find(accountQuery),
      PROFILES_DB.find(usernameQuery),
    ]);

    const metadataResponseDocs = results[0].docs;
    const accountsResponseDocs = results[1].docs;
    const profilesResponseDocs = results[2].docs;

    const allAccounts: s_Account[] = [];
    if (isAddressValid(searchValue)
      && !accountsResponseDocs.find((account) => account.address === searchValue || account.cosmosAddress === searchValue)) {
      allAccounts.push({
        address: searchValue,
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
        publicKey: '',
      });
    }

    //Since we need a profile doc and an account doc to create a BitBadgesUserInfo, we need to query with both queries and then merge the results
    const fetchedAddressesNotInProfileDocs = accountsResponseDocs.filter((account) => !profilesResponseDocs.find((profile) => profile._id === account.cosmosAddress)).map((account) => account.cosmosAddress);
    const fetchedProfileAddressesNotInAccountDocs = profilesResponseDocs.filter((profile) => !accountsResponseDocs.find((account) => account.cosmosAddress === profile._id)).map((profile) => profile._id);

    const promises2 = [];
    promises2.push(ACCOUNTS_DB.fetch({ keys: fetchedAddressesNotInProfileDocs }));
    promises2.push(PROFILES_DB.fetch({ keys: fetchedProfileAddressesNotInAccountDocs }));

    const results2 = await Promise.all(promises2);
    const accountsResponseDocs2 = results2[0].rows.map((row: any) => row.doc);
    const profilesResponseDocs2 = results2[1].rows.map((row: any) => row.doc) as (s_Profile & nano.Document)[];

    for (const account of accountsResponseDocs2) {
      allAccounts.push(account);
    }
    const allProfiles = [...profilesResponseDocs, ...profilesResponseDocs2];

    allAccounts.sort((a, b) => a.address.localeCompare(b.address));
    allProfiles.sort((a, b) => a._id.localeCompare(b._id));

    const accounts: s_BitBadgesUserInfo[] = await convertToBitBadgesUserInfo(allProfiles, allAccounts);
    return res.json({
      collections: metadataResponseDocs,
      accounts: accounts,
    })
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      message: 'Internal server error.'
    })
  }
}
