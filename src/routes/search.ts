
import { AccountDocument, BLANK_USER_INFO, Metadata, BitBadgesUserInfo, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, METADATA_DB } from "../db/db";
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
    } catch (e) { }

    // Search metadata of collections for matching names
    const searchQuery: nano.MangoQuery = {
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
          { "username": { "$regex": `(?i)${searchValue}` } },
        ]
      },
    }

    const results = await Promise.all([
      METADATA_DB.find(searchQuery),
      ACCOUNTS_DB.find(accountQuery),
    ]);

    const metadataResponseDocs = results[0].docs;
    const accountsResponseDocs = results[1].docs;

    const allAccounts: AccountDocument[] = [];
    if (isAddressValid(searchValue) && !accountsResponseDocs.find((account) => account.address === searchValue || account.cosmosAddress === searchValue)) {
      allAccounts.push({
        ...BLANK_USER_INFO,
        address: searchValue,
        cosmosAddress: convertToCosmosAddress(searchValue),
        chain: getChainForAddress(searchValue),
      });
    }

    for (const account of accountsResponseDocs) {
      allAccounts.push({
        ...account,
        chain: getChainForAddress(account.address),
      });
    }

    const accounts: BitBadgesUserInfo[] = await convertToBitBadgesUserInfo(allAccounts);

    return res.json({
      collections: metadataResponseDocs,
      accounts: accounts,
    })
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      emessage: 'Internal server error.'
    })
  }
}
