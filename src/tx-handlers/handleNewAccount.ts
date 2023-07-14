import { BigIntify } from "bitbadgesjs-proto";
import { DocsCache, convertAccountDoc } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/cache";
import { client } from "../indexer";
/**
 * This is a little tricky because we need to handle the case where a user registers
 * with the blockchain, but we already cached a -1 or null accountNumber.
 * 
 * Rare case but it can happen when indexer is catching up.
 * 
 * Solution: Always query the blockchain when this function is called until we have a valid account number.
 */

/**
 * Handles a new account by address.
 */
export const handleNewAccountByAddress = async (cosmosAddress: string, docs: DocsCache): Promise<void> => {

  if (!docs.accounts[cosmosAddress]) {
    await fetchDocsForCacheIfEmpty(docs, [cosmosAddress], [], [], []);
  }

  //If we already have an account doc, we don't need to do anything
  const _accountDoc = docs.accounts[`${cosmosAddress}`];
  if (_accountDoc && _accountDoc.cosmosAddress) {
    return; //Already handled
  }

  const accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(cosmosAddress)
  if (accountInfo) {
    docs.accounts[cosmosAddress] = convertAccountDoc({
      _id: `${cosmosAddress}`,
      _rev: '',
      ...docs.accounts[cosmosAddress],
      ...accountInfo,
    }, BigIntify);
  }
}