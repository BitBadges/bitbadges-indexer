import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountDoc, AccountDocs, BalanceDoc, BalanceDocs, BigIntify, MerkleChallengeDoc, MerkleChallengeDocs, CollectionDoc, CollectionDocs, DocsCache, RefreshDoc, StatusDoc, convertAccountDoc, convertBalanceDoc, convertMerkleChallengeDoc, convertCollectionDoc, ApprovalsTrackerDocs, AddressMappingsDocs, AddressMappingDoc, ApprovalsTrackerDoc, convertApprovalsTrackerDoc } from "bitbadgesjs-utils";
import { serializeError } from "serialize-error";
import { ACCOUNTS_DB, TRANSFER_ACTIVITY_DB, BALANCES_DB, CLAIMS_DB, COLLECTIONS_DB, ERRORS_DB, QUEUE_DB, REFRESHES_DB, insertMany, insertToDB } from "./db";
import { setStatus } from "./status";

/**
 * Fetches docs from DB if they are not already in the docs cache
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCacheIfEmpty(currDocs: DocsCache, cosmosAddresses: string[], collectionIds: bigint[], balanceIds: string[], merkleChallengeIds: string[], approvalsTrackerIds: string[], addressMappingIds: string[]) {
  try {
    const newCollectionIds = collectionIds.map(x => x.toString()).filter((id) => !currDocs.collections[id]); //collectionId as keys (string: `${collectionId}`)
    const newCosmosAddresses = cosmosAddresses.map(x => x.toString()).filter((id) => !currDocs.collections[id]);
    const newApprovalsTrackerIds = approvalsTrackerIds.filter((id) => !currDocs.approvalsTrackers[id]);
    const newAddressMappingIds = addressMappingIds.filter((id) => !currDocs.addressMappings[id]);

    //Partitioned IDs (collectionId:___)
    const newBalanceIds = balanceIds.filter((id) => !currDocs.balances[id]);
    const newMerkleChallengeIds = merkleChallengeIds.filter((id) => !currDocs.claims[id]);

    if (newCollectionIds.length || newBalanceIds.length || newMerkleChallengeIds.length || newCosmosAddresses.length || newApprovalsTrackerIds.length || newAddressMappingIds.length) {
      const newDocs = await fetchDocsForCache(newCosmosAddresses, newCollectionIds, newBalanceIds, newMerkleChallengeIds, newApprovalsTrackerIds, newAddressMappingIds);

      currDocs = {
        accounts: {
          ...currDocs.accounts,
          ...newDocs.accounts
        },
        collections: {
          ...currDocs.collections,
          ...newDocs.collections
        },
        balances: {
          ...currDocs.balances,
          ...newDocs.balances
        },
        merkleChallenges: {
          ...currDocs.merkleChallenges,
          ...newDocs.merkleChallenges
        },
        approvalsTrackers: {
          ...currDocs.approvalsTrackers,
          ...newDocs.approvalsTrackers
        },
        addressMappings: {
          ...currDocs.addressMappings,
          ...newDocs.addressMappings
        },
        activityToAdd: currDocs.activityToAdd,
        queueDocsToAdd: currDocs.queueDocsToAdd,
        //Within the poller, we never require fetching a refresh doc (only adding new ones)
        refreshes: {
          ...currDocs.refreshes,
        }
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
export async function fetchDocsForCache(_cosmosAddresses: string[], _collectionDocIds: string[], _balanceDocIds: string[], _claimDocIds: string[], _approvalsTrackerIds: string[], _addressMappingIds: string[]) {
  try {
    const cosmosAddresses = [...new Set(_cosmosAddresses)].filter((id) => id.length > 0);
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id.length > 0);
    const balanceDocIds = [...new Set(_balanceDocIds)].filter((id) => id.length > 0);
    const claimDocIds = [...new Set(_claimDocIds)].filter((id) => id.length > 0);
    const approvalsTrackerIds = [...new Set(_approvalsTrackerIds)].filter((id) => id.length > 0);
    const addressMappingIds = [...new Set(_addressMappingIds)].filter((id) => id.length > 0);

    const accountsData: AccountDocs = {};
    const collectionData: CollectionDocs = {};
    const balanceData: BalanceDocs = {};
    const claimData: MerkleChallengeDocs = {};
    const approvalsTrackerData: ApprovalsTrackerDocs = {};
    const addressMappingsData: AddressMappingsDocs = {};

    const promises = [];

    for (const address of cosmosAddresses) {
      promises.push(ACCOUNTS_DB.get(address));
    }

    for (const collectionId of collectionDocIds) {
      promises.push(COLLECTIONS_DB.get(collectionId));
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
        const res = result.value as AccountDoc<JSPrimitiveNumberType>;
        const convertedAccount = convertAccountDoc(res, BigIntify);
        accountsData[address] = convertedAccount;
      }
    }

    for (const collectionId of collectionDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as CollectionDoc<JSPrimitiveNumberType>;
        const convertedCollection = convertCollectionDoc(res, BigIntify);
        collectionData[collectionId] = convertedCollection;
      }
    }

    for (const balanceId of balanceDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as BalanceDoc<JSPrimitiveNumberType>;
        const convertedBalanceDoc = convertBalanceDoc(res, BigIntify);
        balanceData[balanceId] = convertedBalanceDoc;
      } else {
        balanceData[balanceId] = {
          _id: balanceId,
          _rev: '',
          balances: [],
          approvals: [],
          collectionId: BigInt(balanceId.split(':')[0]),
          cosmosAddress: balanceId.split(':')[1],
          onChain: true //HACK: Must be set to false if not on chain. True is just default
        }
      }
    }

    for (const claimId of claimDocIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as MerkleChallengeDoc<JSPrimitiveNumberType>;
        const convertedMerkleChallengeDoc = convertMerkleChallengeDoc(res, BigIntify);
        claimData[claimId] = convertedMerkleChallengeDoc;
      }
    }

    for (const addressMappingId of addressMappingIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as AddressMappingDoc;
        const convertedAddressMappingDoc = res;
        addressMappingsData[addressMappingId] = convertedAddressMappingDoc;
      }
    }

    for (const approvalsTrackerId of approvalsTrackerIds) {
      const result = results[idx++];
      if (result.status === 'fulfilled') {
        const res = result.value as ApprovalsTrackerDoc<JSPrimitiveNumberType>;
        const convertedAddressMappingDoc = convertApprovalsTrackerDoc(res, BigIntify);
        approvalsTrackerData[approvalsTrackerId] = convertedAddressMappingDoc;
      }
    }


    return { accounts: accountsData, collections: collectionData, balances: balanceData, claims: claimData, approvalsTrackers: approvalsTrackerData, addressMappings: addressMappingsData }
  } catch (error) {
    throw `Error in fetchDocsForCache(): ${error}`;
  }
}

//Finalize docs at end of handling block(s)
export async function flushCachedDocs(docs: DocsCache, status?: StatusDoc<bigint>) {
  try {
    //If we reach here, we assume that all docs are valid and ready to be inserted into the DB (i.e. not undefined) so we can cast safely
    const promises = [];
    const accountDocs = Object.values(docs.accounts) as (AccountDoc<bigint>)[];
    const collectionDocs = Object.values(docs.collections) as (CollectionDoc<bigint>)[];
    const balanceDocs = Object.values(docs.balances) as (BalanceDoc<bigint>)[];
    const claimDocs = Object.values(docs.claims) as (MerkleChallengeDoc<bigint>)[];
    const refreshDocs = Object.values(docs.refreshes) as (RefreshDoc<bigint>)[];
    const activityDocs = docs.activityToAdd;
    const queueDocs = docs.queueDocsToAdd;


    if (activityDocs.length) {
      promises.push(insertMany(TRANSFER_ACTIVITY_DB, activityDocs));
    }

    if (queueDocs.length) {
      promises.push(insertMany(QUEUE_DB, queueDocs));
    }

    if (accountDocs.length) {
      promises.push(insertMany(ACCOUNTS_DB, accountDocs));
    }

    if (collectionDocs.length) {
      promises.push(insertMany(COLLECTIONS_DB, collectionDocs));
    }

    if (balanceDocs.length) {
      promises.push(insertMany(BALANCES_DB, balanceDocs));
    }

    if (claimDocs.length) {
      promises.push(insertMany(CLAIMS_DB, claimDocs));
    }

    if (refreshDocs.length) {
      promises.push(insertMany(REFRESHES_DB, refreshDocs));
    }

    if (status) {
      promises.push(setStatus(status));
    }

    //TODO: Handle if error in one of these but not the rest
    if (promises.length) {
      await Promise.all(promises);
    }
  } catch (error) {
    await insertToDB(ERRORS_DB, {
      function: 'flushCachedDocs',
      error: serializeError(error),
      docs: docs
    });

    throw `Error in flushCachedDocs(): ${error}`;
  }
}
