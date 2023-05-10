import { config } from "dotenv";
import Nano from "nano";
import { ActivityItem, AccountDocument, DbStatus, MetadataDocument, PasswordDocument, CollectionDocument, AccountDocs, CollectionDocs, MetadataDocs, BalanceDocument, DocsCache, BalanceDocs, ClaimDocument, ClaimDocs, isAddressValid, getChainForAddress, SupportedChain } from 'bitbadgesjs-utils';

config();

const nano = Nano(`${process.env.DB_URL}`);

export const ACTIVITY_DB = nano.db.use<ActivityItem>('activity'); //partitioned
export const ACCOUNTS_DB = nano.db.use<AccountDocument>('accounts');
export const COLLECTIONS_DB = nano.db.use<CollectionDocument>('collections');
export const STATUS_DB = nano.db.use<DbStatus>('status');
export const ERRORS_DB = nano.db.use<any>('errors');
export const METADATA_DB = nano.db.use<MetadataDocument>('metadata'); //partitioned
export const PASSWORDS_DB = nano.db.use<PasswordDocument>('passwords');
export const AIRDROP_DB = nano.db.use<any>('airdrop');
export const BALANCES_DB = nano.db.use<BalanceDocument>('balances');
export const CLAIMS_DB = nano.db.use<ClaimDocument>('claims');

/**
 * Fetches docs from DB if they are not already in the docs cache
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForRequestIfEmpty(currDocs: DocsCache, accountKeys: string[], collectionIds: number[], metadataIds: string[], balanceIds: string[], claimIds: string[]) {
  try {
    const newCollectionIds = collectionIds.filter((id) => !currDocs.collections[id]); //collectionId as keys (string: `${collectionId}`)
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

      const accountNumbersMap = {};
      for (const _account of Object.values(newAccounts)) {
        //We cast here for TypeScript but accounts could also be { _id: string } type 
        const account = _account as AccountDocument & Nano.DocumentGetResponse;

        if (account.cosmosAddress && account.accountNumber >= 0) {
          accountNumbersMap[account.cosmosAddress] = account.accountNumber;
        }
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
        accountNumbersMap,
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
export async function fetchDocsForRequest(_cosmosAddresses: string[], _collectionDocIds: number[], _metadataDocIds: string[], _balanceDocIds: string[], _claimDocIds: string[]) {
  try {
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id >= 0);
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
      promises.push(COLLECTIONS_DB.get(collectionId.toString(10)));
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
        collectionData[collectionId] = result.value as Nano.DocumentGetResponse & CollectionDocument;
      } else {
        collectionData[collectionId] = {
          _id: collectionId.toString(10)
        }
      }
    }

    for (const cosmosAddress of accountDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        accountData[cosmosAddress] = result.value as Nano.DocumentGetResponse & AccountDocument;
      } else {
        accountData[cosmosAddress] = {
          _id: cosmosAddress
        }
      }
    }

    for (const metadataId of metadataDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        metadataData[metadataId] = result.value as Nano.DocumentGetResponse & MetadataDocument;
      } else {
        metadataData[metadataId] = {
          _id: metadataId
        }
      }
    }

    for (const balanceId of balanceDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        balanceData[balanceId] = result.value as Nano.DocumentGetResponse & BalanceDocument;
      } else {
        balanceData[balanceId] = {
          _id: balanceId,
          balances: [],
          approvals: [],
          collectionId: Number(balanceId.split(':')[0]),
          cosmosAddress: balanceId.split(':')[1]
        }
      }
    }

    for (const claimId of claimDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        claimData[claimId] = result.value as Nano.DocumentGetResponse & ClaimDocument;
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
    const promises = [];
    const accountDocs = Object.values(docs.accounts);
    const collectionDocs = Object.values(docs.collections);
    const metadataDocs = Object.values(docs.metadata);
    const balanceDocs = Object.values(docs.balances);
    const claimDocs = Object.values(docs.claims);

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
