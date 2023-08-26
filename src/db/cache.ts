import { JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { AccountDoc, AccountDocs, AddressMappingDoc, AddressMappingsDocs, ApprovalsTrackerDoc, ApprovalsTrackerDocs, BalanceDoc, BalanceDocs, BigIntify, CollectionDoc, CollectionDocs, DocsCache, MerkleChallengeDoc, MerkleChallengeDocs, RefreshDoc, StatusDoc, convertAccountDoc, convertAddressMappingDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertCollectionDoc, convertMerkleChallengeDoc } from "bitbadgesjs-utils";
import { DocumentFetchResponse } from "nano";
import { serializeError } from "serialize-error";
import { getDocsFromNanoFetchRes } from "../utils/couchdb-utils";
import { ACCOUNTS_DB, ADDRESS_MAPPINGS_DB, APPROVALS_TRACKER_DB, BALANCES_DB, COLLECTIONS_DB, ERRORS_DB, MERKLE_CHALLENGES_DB, QUEUE_DB, REFRESHES_DB, TRANSFER_ACTIVITY_DB, insertMany, insertToDB } from "./db";
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
    const newMerkleChallengeIds = merkleChallengeIds.filter((id) => !currDocs.merkleChallenges[id]);

    if (newCollectionIds.length || newBalanceIds.length || newMerkleChallengeIds.length || newCosmosAddresses.length || newApprovalsTrackerIds.length || newAddressMappingIds.length) {
      const newDocs = await fetchDocsForCache(newCosmosAddresses, newCollectionIds, newBalanceIds, newMerkleChallengeIds, newApprovalsTrackerIds, newAddressMappingIds);
      currDocs.accounts = {
        ...currDocs.accounts,
        ...newDocs.accounts
      }

      currDocs.collections = {
        ...currDocs.collections,
        ...newDocs.collections
      }

      currDocs.balances = {
        ...currDocs.balances,
        ...newDocs.balances
      }
      currDocs.merkleChallenges = {
        ...currDocs.merkleChallenges,
        ...newDocs.merkleChallenges
      }
      currDocs.approvalsTrackers = {
        ...currDocs.approvalsTrackers,
        ...newDocs.approvalsTrackers
      }
      currDocs.addressMappings = {
        ...currDocs.addressMappings,
        ...newDocs.addressMappings
      }
      currDocs.activityToAdd = currDocs.activityToAdd
      currDocs.queueDocsToAdd = currDocs.queueDocsToAdd
      //Within the poller, we never require fetching a refresh doc (only adding new ones)
      currDocs.refreshes = currDocs.refreshes
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
    if (cosmosAddresses.length) promises.push(ACCOUNTS_DB.fetch({ keys: cosmosAddresses }, { include_docs: true }));
    if (collectionDocIds.length) promises.push(COLLECTIONS_DB.fetch({ keys: collectionDocIds }, { include_docs: true }));
    if (balanceDocIds.length) promises.push(BALANCES_DB.fetch({ keys: balanceDocIds }, { include_docs: true }));
    if (claimDocIds.length) promises.push(MERKLE_CHALLENGES_DB.fetch({ keys: claimDocIds }, { include_docs: true }));
    if (approvalsTrackerIds.length) promises.push(APPROVALS_TRACKER_DB.fetch({ keys: approvalsTrackerIds }, { include_docs: true }));
    if (addressMappingIds.length) promises.push(ADDRESS_MAPPINGS_DB.fetch({ keys: addressMappingIds }, { include_docs: true }));

    if (promises.length) {
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
      if (cosmosAddresses.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<AccountDoc<JSPrimitiveNumberType>>, true).map(x => convertAccountDoc(x, BigIntify));
          for (const address of cosmosAddresses) {
            accountsData[address] = docs.find(x => x._id === address);
          }
        }
      }

      if (collectionDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<CollectionDoc<JSPrimitiveNumberType>>, true).map(x => convertCollectionDoc(x, BigIntify));
          for (const collectionId of collectionDocIds) {
            collectionData[collectionId] = docs.find(x => x._id === collectionId);
          }
        }
      }

      if (balanceDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<BalanceDoc<JSPrimitiveNumberType>>, true).map(x => convertBalanceDoc(x, BigIntify));
          for (const balanceId of balanceDocIds) {
            balanceData[balanceId] = docs.find(x => x._id === balanceId);
          }
        }
      }

      if (claimDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<MerkleChallengeDoc<JSPrimitiveNumberType>>, true).map(x => convertMerkleChallengeDoc(x, BigIntify));
          for (const claimId of claimDocIds) {
            claimData[claimId] = docs.find(x => x._id === claimId);
          }
        }
      }

      if (addressMappingIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<AddressMappingDoc<JSPrimitiveNumberType>>, true).map(x => convertAddressMappingDoc(x, BigIntify));
          for (const addressMappingId of addressMappingIds) {
            addressMappingsData[addressMappingId] = docs.find(x => x._id === addressMappingId);
          }
        }
      }

      if (approvalsTrackerIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = getDocsFromNanoFetchRes(result.value as DocumentFetchResponse<ApprovalsTrackerDoc<JSPrimitiveNumberType>>, true).map(x => convertApprovalsTrackerDoc(x, BigIntify));
          for (const approvalsTrackerId of approvalsTrackerIds) {
            approvalsTrackerData[approvalsTrackerId] = docs.find(x => x._id === approvalsTrackerId);
          }
        }
      }
    }

    return { accounts: accountsData, collections: collectionData, balances: balanceData, merkleChallenges: claimData, approvalsTrackers: approvalsTrackerData, addressMappings: addressMappingsData }
  } catch (error) {
    throw `Error in fetchDocsForCache(): ${error}`;
  }
}

//Finalize docs at end of handling block(s)
export async function flushCachedDocs(docs: DocsCache, status?: StatusDoc<bigint>, skipStatusFlushIfEmptyBlock?: boolean) {
  try {
    //If we reach here, we assume that all docs are valid and ready to be inserted into the DB (i.e. not undefined) so we can cast safely
    const promises = [];
    const accountDocs = Object.values(docs.accounts) as (AccountDoc<bigint>)[];
    const collectionDocs = Object.values(docs.collections) as (CollectionDoc<bigint>)[];
    const balanceDocs = Object.values(docs.balances) as (BalanceDoc<bigint>)[];
    const claimDocs = Object.values(docs.merkleChallenges) as (MerkleChallengeDoc<bigint>)[];
    const refreshDocs = Object.values(docs.refreshes) as (RefreshDoc<bigint>)[];
    const approvalsTrackerDocs = Object.values(docs.approvalsTrackers) as (ApprovalsTrackerDoc<bigint>)[];
    const addressMappingDocs = Object.values(docs.addressMappings) as (AddressMappingDoc<bigint>)[];
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
      promises.push(insertMany(MERKLE_CHALLENGES_DB, claimDocs));
    }

    if (refreshDocs.length) {
      promises.push(insertMany(REFRESHES_DB, refreshDocs));
    }

    if (approvalsTrackerDocs.length) {
      promises.push(insertMany(APPROVALS_TRACKER_DB, approvalsTrackerDocs));
    }

    if (addressMappingDocs.length) {
      promises.push(insertMany(ADDRESS_MAPPINGS_DB, addressMappingDocs));
    }



    // console.log(promises.length);
    //TODO: Handle if error in one of these but not the rest
    if (promises.length === 0 && status && skipStatusFlushIfEmptyBlock) {
      // console.log('fast catch up');
      return false;
    } else if (promises.length || status) {
      if (status) {
        promises.push(setStatus(status));
      }
      await Promise.all(promises);
    }

    return true;
  } catch (error) {
    await insertToDB(ERRORS_DB, {
      function: 'flushCachedDocs',
      error: serializeError(error),
      docs: docs
    });

    throw `Error in flushCachedDocs(): ${error}`;
  }
}
