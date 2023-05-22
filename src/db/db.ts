import { Account, AccountDocs, BalanceDocs, BalanceDocument, ClaimDocs, ClaimDocument, Collection, CollectionDocs, DbStatus, DocsCache, MetadataDoc, MetadataDocs, convertFromAccount, convertFromBalanceDocument, convertFromClaimDocument, convertFromCollection, convertFromMetadataDoc, convertToAccount, convertToBalanceDocument, convertToClaimDocument, convertToCollection, convertToMetadataDoc, s_Account, s_ActivityItem, s_BalanceDocument, s_ClaimDocument, s_Collection, s_DbStatus, s_MetadataDoc, s_PasswordDocument, s_Profile } from 'bitbadgesjs-utils';
import { config } from "dotenv";
import Nano from "nano";
import { setStatus } from './status';

config();

const nano = Nano(`${process.env.DB_URL}`);

export const ACTIVITY_DB = nano.db.use<s_ActivityItem>('activity'); //partitioned
export const PROFILES_DB = nano.db.use<s_Profile>('profiles');
export const ACCOUNTS_DB = nano.db.use<s_Account>('accounts');
export const COLLECTIONS_DB = nano.db.use<s_Collection>('collections');
export const STATUS_DB = nano.db.use<s_DbStatus>('status');
export const ERRORS_DB = nano.db.use<any>('errors');
export const METADATA_DB = nano.db.use<s_MetadataDoc>('metadata'); //partitioned
export const PASSWORDS_DB = nano.db.use<s_PasswordDocument>('passwords');
export const AIRDROP_DB = nano.db.use<any>('airdrop');
export const BALANCES_DB = nano.db.use<s_BalanceDocument>('balances');
export const CLAIMS_DB = nano.db.use<s_ClaimDocument>('claims');
export const FETCHES_DB = nano.db.use<any>('fetches');

/**
 * Fetches docs from DB if they are not already in the docs cache
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCacheIfEmpty(currDocs: DocsCache, cosmosAddresses: string[], collectionIds: bigint[], metadataIds: string[], balanceIds: string[], claimIds: string[]) {
  try {
    const newCollectionIds = collectionIds.map(x => x.toString()).filter((id) => !currDocs.collections[id]); //collectionId as keys (string: `${collectionId}`)
    const newCosmosAddresses = cosmosAddresses.map(x => x.toString()).filter((id) => !currDocs.collections[id]);

    //Partitioned IDs (collectionId:___)
    const newMetadataIds = metadataIds.filter((id) => !currDocs.metadata[id]);
    const newBalanceIds = balanceIds.filter((id) => !currDocs.balances[id]);
    const newClaimIds = claimIds.filter((id) => !currDocs.claims[id]);

    if (newCollectionIds.length || newMetadataIds.length || newBalanceIds.length || newClaimIds.length || newCosmosAddresses.length) {
      const newDocs = await fetchDocsForCache(newCosmosAddresses, newCollectionIds, newMetadataIds, newBalanceIds, newClaimIds);

      currDocs = {
        accounts: {
          ...currDocs.accounts,
          ...newDocs.accounts
        },
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
    throw `Error in fetchDocsForCacheIfEmpty(): ${error}`;
  }
}

/**
 * Fetches the docs with the provided IDs from each respective DB.
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCache(_cosmosAddresses: string[], _collectionDocIds: string[], _metadataDocIds: string[], _balanceDocIds: string[], _claimDocIds: string[]) {
  try {
    const cosmosAddresses = [...new Set(_cosmosAddresses)].filter((id) => id.length > 0);
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id.length > 0);
    const metadataDocIds = [...new Set(_metadataDocIds)].filter((id) => id.length > 0);
    const balanceDocIds = [...new Set(_balanceDocIds)].filter((id) => id.length > 0);
    const claimDocIds = [...new Set(_claimDocIds)].filter((id) => id.length > 0);

    const accountsData: AccountDocs = {};
    const collectionData: CollectionDocs = {};
    const metadataData: MetadataDocs = {};
    const balanceData: BalanceDocs = {};
    const claimData: ClaimDocs = {};

    const promises = [];

    for (const address of cosmosAddresses) {
      promises.push(ACCOUNTS_DB.get(address));
    }

    for (const collectionId of collectionDocIds) {
      promises.push(COLLECTIONS_DB.get(collectionId));
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


    const results = await Promise.allSettled(promises);

    //Throw if non-404 error
    for (const result of results) {
      if (result.status === 'rejected') {
        //TODO: check if this works
        if (result.reason.statusCode === 404) {
          continue;
        } else {
          throw result.reason;
        }
      }
    }

    let idx = 0;
    for (const address of cosmosAddresses) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as Nano.DocumentGetResponse & s_Account;
        const convertedAccount = convertToAccount(res) as Nano.DocumentGetResponse & Account;
        accountsData[address] = convertedAccount;
      } else {
        accountsData[address] = {
          _id: address
        }
      }
    }

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



    return { accounts: accountsData, collections: collectionData, metadata: metadataData, balances: balanceData, claims: claimData };
  } catch (error) {
    throw `Error in fetchDocsForCache(): ${error}`;
  }
}

//Finalize docs at end of handling block(s)
export async function flushCachedDocs(docs: DocsCache, status: DbStatus) {
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

    promises.push(setStatus(status));

    //TODO: Handle if error in one of these but not the rest
    if (promises.length) {
      await Promise.all(promises);
    }
  } catch (error) {
    await ERRORS_DB.insert({
      type: 'flushCachedDocs',
      error: error,
      docs: docs
    });

    throw `Error in flushCachedDocs(): ${error}`;
  }
}
