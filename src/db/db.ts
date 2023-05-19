import { config } from "dotenv";
import Nano from "nano";
import { s_ActivityItem, s_Account, s_DbStatus, s_MetadataDoc, PasswordDocument, s_Collection, AccountDocs, CollectionDocs, MetadataDocs, s_BalanceDocument, DocsCache, BalanceDocs, s_ClaimDocument, ClaimDocs, isAddressValid, getChainForAddress, SupportedChain, Account, BalanceDocument, ClaimDocument, Collection, MetadataDoc, convertToCollection, convertToAccount, convertToMetadataDoc, convertToBalanceDocument, convertToClaimDocument, convertFromAccount, convertFromBalanceDocument, convertFromClaimDocument, convertFromCollection, convertFromMetadataDoc } from 'bitbadgesjs-utils';

config();

const nano = Nano(`${process.env.DB_URL}`);

export const ACTIVITY_DB = nano.db.use<s_ActivityItem>('activity'); //partitioned
export const ACCOUNTS_DB = nano.db.use<s_Account>('accounts');
export const COLLECTIONS_DB = nano.db.use<s_Collection>('collections');
export const STATUS_DB = nano.db.use<s_DbStatus>('status');
export const ERRORS_DB = nano.db.use<any>('errors');
export const METADATA_DB = nano.db.use<s_MetadataDoc>('metadata'); //partitioned
export const PASSWORDS_DB = nano.db.use<PasswordDocument>('passwords');
export const AIRDROP_DB = nano.db.use<any>('airdrop');
export const BALANCES_DB = nano.db.use<s_BalanceDocument>('balances');
export const CLAIMS_DB = nano.db.use<s_ClaimDocument>('claims');

/**
 * Fetches docs from DB if they are not already in the docs cache
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForRequestIfEmpty(currDocs: DocsCache, accountKeys: string[], collectionIds: bigint[], metadataIds: string[], balanceIds: string[], claimIds: string[]) {
  try {
    const newCollectionIds = collectionIds.map(x => x.toString()).filter((id) => !currDocs.collections[id]); //collectionId as keys (string: `${collectionId}`)
    const newAccountKeys = accountKeys.filter((address) => !currDocs.accounts[address]); //cosmosAddresses as keys

    //Partitioned IDs (collectionId:___)
    const newMetadataIds = metadataIds.filter((id) => !currDocs.metadata[id]);
    const newBalanceIds = balanceIds.filter((id) => !currDocs.balances[id]);
    const newClaimIds = claimIds.filter((id) => !currDocs.claims[id]);

    if (newCollectionIds.length || newAccountKeys.length || newMetadataIds.length || newBalanceIds.length || newClaimIds.length) {
      const newDocs = await fetchDocsForRequest(newAccountKeys, newCollectionIds, newMetadataIds, newBalanceIds, newClaimIds);

      const newAccounts = {
        ...currDocs.accounts,
        ...newDocs.accounts
      }

      currDocs = {
        accounts: newAccounts,
        collections: {
          ...currDocs.collections,
          ...newDocs.collections
        },
        metadata: {
          ...currDocs.metadata,
          ...newDocs.metadata
        },
        balances: {
          ...currDocs.balances,
          ...newDocs.balances
        },
        claims: {
          ...currDocs.claims,
          ...newDocs.claims
        },
        activityToAdd: currDocs.activityToAdd
      };
    }
  } catch (error) {
    throw `Error in fetchDocsForRequestIfEmpty(): ${error}`;
  }
}

/**
 * Fetches the docs with the provided IDs from each respective DB.
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForRequest(_cosmosAddresses: string[], _collectionDocIds: string[], _metadataDocIds: string[], _balanceDocIds: string[], _claimDocIds: string[]) {
  try {
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id.length > 0);
    const accountDocIds = [...new Set(_cosmosAddresses)].filter((address) => address.length > 0 && isAddressValid(address) && getChainForAddress(address) === SupportedChain.COSMOS);
    const metadataDocIds = [...new Set(_metadataDocIds)].filter((id) => id.length > 0);
    const balanceDocIds = [...new Set(_balanceDocIds)].filter((id) => id.length > 0);
    const claimDocIds = [...new Set(_claimDocIds)].filter((id) => id.length > 0);

    const accountData: AccountDocs = {};
    const collectionData: CollectionDocs = {};
    const metadataData: MetadataDocs = {};
    const balanceData: BalanceDocs = {};
    const claimData: ClaimDocs = {};

    const promises = [];

    for (const collectionId of collectionDocIds) {
      promises.push(COLLECTIONS_DB.get(collectionId));
    }

    for (const accountAddress of accountDocIds) {
      promises.push(ACCOUNTS_DB.get(accountAddress));
    }

    for (const metadataId of metadataDocIds) {
      promises.push(METADATA_DB.get(metadataId));
    }

    for (const balanceId of balanceDocIds) {
      promises.push(BALANCES_DB.get(balanceId));
    }

    for (const claimId of claimDocIds) {
      promises.push(CLAIMS_DB.get(claimId));
    }

    //TODO: handle if miscellanous error and not missing doc
    const results = await Promise.allSettled(promises);

    let idx = 0;
    for (const collectionId of collectionDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_Collection;
        const convertToedCollection = convertToCollection(res) as Nano.DocumentGetResponse & Collection;
        collectionData[collectionId] = convertToedCollection;
      } else {
        collectionData[collectionId] = {
          _id: collectionId
        }
      }
    }


    for (const cosmosAddress of accountDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_Account;
        const convertToedAccount = convertToAccount(res) as Nano.DocumentGetResponse & Account;
        accountData[cosmosAddress] = convertToedAccount;
      } else {
        accountData[cosmosAddress] = {
          _id: cosmosAddress
        }
      }
    }

    for (const metadataId of metadataDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_MetadataDoc;
        const convertToedMetadataDoc = convertToMetadataDoc(res) as Nano.DocumentGetResponse & MetadataDoc;
        metadataData[metadataId] = convertToedMetadataDoc;
      } else {
        metadataData[metadataId] = {
          _id: metadataId
        }
      }
    }

    for (const balanceId of balanceDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_BalanceDocument;
        const convertToedBalanceDoc = convertToBalanceDocument(res) as Nano.DocumentGetResponse & BalanceDocument;
        balanceData[balanceId] = convertToedBalanceDoc;
      } else {
        balanceData[balanceId] = {
          _id: balanceId,
          balances: [],
          approvals: [],
          collectionId: BigInt(balanceId.split(':')[0]),
          cosmosAddress: balanceId.split(':')[1]
        }
      }
    }

    for (const claimId of claimDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_ClaimDocument;
        const convertToedClaimDoc = convertToClaimDocument(res) as Nano.DocumentGetResponse & ClaimDocument;
        claimData[claimId] = convertToedClaimDoc;
      } else {
        claimData[claimId] = {
          _id: claimId
        }
      }
    }

    return { accounts: accountData, collections: collectionData, metadata: metadataData, balances: balanceData, claims: claimData };
  } catch (error) {
    throw `Error in fetchDocsForRequest(): ${error}`;
  }
}

//Finalize docs at end of handling block(s)
export async function finalizeDocsForRequest(docs: DocsCache) {
  try {
    //If we reach here, we can assume that all docs are valid and can be added to the DB (i.e. no empty { _id: string } docs
    const promises = [];
    const accountDocs = Object.values(docs.accounts).map((x) => convertFromAccount(x as Account));
    const collectionDocs = Object.values(docs.collections).map((x) => convertFromCollection(x as Collection));
    const metadataDocs = Object.values(docs.metadata).map((x) => convertFromMetadataDoc(x as MetadataDoc));
    const balanceDocs = Object.values(docs.balances).map((x) => convertFromBalanceDocument(x as BalanceDocument));
    const claimDocs = Object.values(docs.claims).map((x) => convertFromClaimDocument(x as ClaimDocument));

    if (docs.activityToAdd.length) {
      promises.push(ACTIVITY_DB.bulk({ docs: docs.activityToAdd }));
    }

    if (accountDocs.length) {
      promises.push(ACCOUNTS_DB.bulk({ docs: accountDocs }));
    }

    if (collectionDocs.length) {
      promises.push(COLLECTIONS_DB.bulk({ docs: collectionDocs }));
    }

    if (metadataDocs.length) {
      promises.push(METADATA_DB.bulk({ docs: metadataDocs }));
    }

    if (balanceDocs.length) {
      promises.push(BALANCES_DB.bulk({ docs: balanceDocs }));
    }

    if (claimDocs.length) {
      promises.push(CLAIMS_DB.bulk({ docs: claimDocs }));
    }

    if (promises.length) {
      await Promise.all(promises);
    }
  } catch (error) {
    throw `Error in finalizeDocsForRequest(): ${error}`;
  }
}
