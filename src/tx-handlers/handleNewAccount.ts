import { BigIntify } from "bitbadgesjs-proto";
import { DocsCache, SupportedChain, convertAccountDoc } from "bitbadgesjs-utils";
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
export const handleNewAccountByAddress = async (cosmosAddress: string, docs: DocsCache, solanaAddress?: string): Promise<void> => {

  if (!docs.accounts[cosmosAddress]) {
    await fetchDocsForCacheIfEmpty(docs, [cosmosAddress], [], [], [], [], [], []);
  }




  //If we already have an account doc with an acct number and public key, we don't need to do anything
  const _accountDoc = docs.accounts[`${cosmosAddress}`]
  //TODO: Does this eventually write even if unchanged?
  if (_accountDoc && _accountDoc.accountNumber > 0n && _accountDoc.publicKey) {
    //if we have a valid solana address for the first time, we add it to the account doc
    //note that the chain checks this is the correct address (matches signer key)
    if (_accountDoc.chain === SupportedChain.SOLANA && solanaAddress && !_accountDoc.solAddress) {
      _accountDoc.solAddress = solanaAddress
      docs.accounts[cosmosAddress] = _accountDoc
    }
    return; //Already handled
  }

  const accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(cosmosAddress)
  if (accountInfo) {
    docs.accounts[cosmosAddress] = convertAccountDoc({
      _id: `${cosmosAddress}`,
      _rev: undefined,
      ...docs.accounts[cosmosAddress],
      ...accountInfo,
      solAddress: solanaAddress ? solanaAddress : docs.accounts[cosmosAddress]?.solAddress ?? '', //Solana address is inserted manually by extension options (bc we can't revert the hash)
      sequence: undefined, //We dynamically fetch this currently. Can maybe do it here in the future.
    }, BigIntify);
  }
}