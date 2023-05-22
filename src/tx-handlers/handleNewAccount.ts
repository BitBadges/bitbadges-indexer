import { Account, DocsCache } from "bitbadgesjs-utils";
import { fetchDocsForCacheIfEmpty } from "../db/db";
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
    await fetchDocsForCacheIfEmpty(docs, [cosmosAddress], [], [], [], []);
  }
  //Query if we don't have account number (e.g. is just an { _id } new account type) or account number is -1 (e.g. not registered yet but has an account doc generated off-chain)

  //Typecast to avoid TS error (could still just be an { _id } type)
  //If this check fails, we need to query the blockchain
  const _accountDoc = docs.accounts[`${cosmosAddress}`] as Account & { _id: string };
  if (_accountDoc.cosmosAddress) {
    return; //Already handled
  }

  const accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(cosmosAddress)
  if (accountInfo) {
    docs.accounts[cosmosAddress] = {
      ...docs.accounts[cosmosAddress],
      _id: `${cosmosAddress}`,
      ...accountInfo,
    }
  }
}