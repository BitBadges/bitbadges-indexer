import { AccountDocument, DocsCache } from "bitbadgesjs-utils";
import { fetchDocsForRequestIfEmpty } from "../db/db";
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
 * Handles a new account by account number.
 * 
 * IMPORTANT: Only call if you are sure the account number is >= 0 and registered on blockchain.
 */
export const handleNewAccount = async (accountNum: number, docs: DocsCache): Promise<void> => {
  if (accountNum < 0) {
    throw `Error in handleNewAccount(): accountNum must be positive. Received ${accountNum}`;
  }

  const idx = Object.values(docs.accountNumbersMap).indexOf(accountNum);
  //Already handled
  if (idx >= 0 && Object.keys(docs.accounts)[idx]) {
    return;
  }


  //Already handled this account number
  if (Object.values(docs.accountNumbersMap).includes(accountNum)) {
    return;
  } else {
    const accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(accountNum)
    if (!accountInfo || accountInfo.accountNumber < 0) {
      throw `Error in handleNewAccount(): accountInfo is null or accountNumber is negative. Received ${accountInfo}`;
    }

    if (accountInfo) {
      const cosmosAddress = accountInfo.cosmosAddress;
      await fetchDocsForRequestIfEmpty(docs, [cosmosAddress], [], [], [], []);

      docs.accounts[cosmosAddress] = {
        ...docs.accounts[cosmosAddress],
        _id: `${cosmosAddress}`,
        ...accountInfo, //Update account info with new values, if any (e.g. sequence, etc). Will also overwrite a -1 account number
      }
      docs.accountNumbersMap[accountInfo.cosmosAddress] = accountNum;
    }
  }
}

/**
 * Handles a new account by address.
 */
export const handleNewAccountByAddress = async (cosmosAddress: string, docs: DocsCache): Promise<void> => {
  await fetchDocsForRequestIfEmpty(docs, [cosmosAddress], [], [], [], []);

  //Query if we don't have account number (e.g. is just an { _id } new account type) or account number is -1 (e.g. not registered yet but has an account doc generated off-chain)

  //Typecast to avoid TS error (could still just be an { _id } type)
  //If this check fails, we need to query the blockchain
  const _accountDoc = docs.accounts[`${cosmosAddress}`] as AccountDocument & { _id: string };
  if (_accountDoc.cosmosAddress && _accountDoc.accountNumber >= 0) {
    return; //Already handled
  }

  const accountInfo = await client.badgesQueryClient?.badges.getAccountInfo(cosmosAddress)
  if (accountInfo) {
    const accountNum = accountInfo?.accountNumber >= 0 ? Number(accountInfo.accountNumber) : -1;
    docs.accounts[cosmosAddress] = {
      ...docs.accounts[cosmosAddress],
      _id: `${cosmosAddress}`,
      ...accountInfo,
    }

    if (accountNum >= 0) {
      docs.accountNumbersMap[accountInfo.cosmosAddress] = accountNum;
    }
  }
}