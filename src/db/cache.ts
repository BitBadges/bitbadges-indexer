import { NumberType } from "bitbadgesjs-proto";
import { AccountDoc, AccountDocs, AddressMappingDoc, AddressMappingsDocs, ApprovalsTrackerDoc, ApprovalsTrackerDocs, BalanceDoc, BalanceDocs, BigIntify, CollectionDoc, CollectionDocs, DocsCache, MerkleChallengeDoc, MerkleChallengeDocs, PasswordDoc, PasswordDocs, RefreshDoc, StatusDoc, convertAccountDoc, convertAddressMappingDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertCollectionDoc, convertMerkleChallengeDoc, convertPasswordDoc } from "bitbadgesjs-utils";
import mongoose from "mongoose";
import { serializeError } from "serialize-error";
import { AccountModel, AddressMappingModel, ApprovalsTrackerModel, BalanceModel, ClaimAlertModel, CollectionModel, ErrorModel, MerkleChallengeModel, PasswordModel, QueueModel, RefreshModel, TransferActivityModel, getManyFromDB, insertMany, insertToDB } from "./db";
import { setStatus } from "./status";

/**
 * Fetches docs from DB if they are not already in the docs cache
 * 
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCacheIfEmpty(currDocs: DocsCache, cosmosAddresses: string[], collectionIds: bigint[], balanceIds: string[], merkleChallengeIds: string[], approvalsTrackerIds: string[], addressMappingIds: string[], passwordDocIds: string[], session?: mongoose.mongo.ClientSession) {
  try {
    const newCollectionIds = collectionIds.map(x => x.toString()).filter((id) => !currDocs.collections[id]); //collectionId as keys (string: `${collectionId}`)
    const newCosmosAddresses = cosmosAddresses.map(x => x.toString()).filter((id) => !currDocs.collections[id]);
    const newApprovalsTrackerIds = approvalsTrackerIds.filter((id) => !currDocs.approvalsTrackers[id]);
    const newAddressMappingIds = addressMappingIds.filter((id) => !currDocs.addressMappings[id]);
    const newPasswordDocIds = passwordDocIds.filter((id) => !currDocs.passwordDocs[id]);

    //Partitioned IDs (collectionId:___)
    const newBalanceIds = balanceIds.filter((id) => !currDocs.balances[id]);
    const newMerkleChallengeIds = merkleChallengeIds.filter((id) => !currDocs.merkleChallenges[id]);

    if (newCollectionIds.length || newBalanceIds.length || newMerkleChallengeIds.length || newCosmosAddresses.length || newApprovalsTrackerIds.length || newAddressMappingIds.length || newPasswordDocIds.length) {
      const newDocs = await fetchDocsForCache(newCosmosAddresses, newCollectionIds, newBalanceIds, newMerkleChallengeIds, newApprovalsTrackerIds, newAddressMappingIds, newPasswordDocIds, session);
      currDocs.accounts = {
        ...currDocs.accounts,
        ...newDocs.accounts
      }

      currDocs.passwordDocs = {
        ...currDocs.passwordDocs,
        ...newDocs.passwordDocs
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
      currDocs.claimAlertsToAdd = currDocs.claimAlertsToAdd
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
export async function fetchDocsForCache(_cosmosAddresses: string[], _collectionDocIds: string[], _balanceDocIds: string[], _claimDocIds: string[], _approvalsTrackerIds: string[], _addressMappingIds: string[], _passwordDocIds: string[], session?: mongoose.mongo.ClientSession) {
  try {
    const cosmosAddresses = [...new Set(_cosmosAddresses)].filter((id) => id.length > 0);
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id.length > 0);
    const balanceDocIds = [...new Set(_balanceDocIds)].filter((id) => id.length > 0);
    const claimDocIds = [...new Set(_claimDocIds)].filter((id) => id.length > 0);
    const approvalsTrackerIds = [...new Set(_approvalsTrackerIds)].filter((id) => id.length > 0);
    const addressMappingIds = [...new Set(_addressMappingIds)].filter((id) => id.length > 0);
    const passwordDocIds = [...new Set(_passwordDocIds)].filter((id) => id.length > 0);

    const accountsData: AccountDocs = {};
    const collectionData: CollectionDocs = {};
    const balanceData: BalanceDocs = {};
    const claimData: MerkleChallengeDocs = {};
    const approvalsTrackerData: ApprovalsTrackerDocs = {};
    const addressMappingsData: AddressMappingsDocs = {};
    const passwordDocs: PasswordDocs = {};


    const promises = [];
    if (cosmosAddresses.length) promises.push(getManyFromDB(AccountModel, cosmosAddresses, session));
    if (collectionDocIds.length) promises.push(getManyFromDB(CollectionModel, collectionDocIds, session));
    if (balanceDocIds.length) promises.push(getManyFromDB(BalanceModel, balanceDocIds, session));
    if (claimDocIds.length) promises.push(getManyFromDB(MerkleChallengeModel, claimDocIds, session));
    if (approvalsTrackerIds.length) promises.push(getManyFromDB(ApprovalsTrackerModel, approvalsTrackerIds, session));
    if (addressMappingIds.length) promises.push(getManyFromDB(AddressMappingModel, addressMappingIds, session));
    if (passwordDocIds.length) promises.push(getManyFromDB(PasswordModel, passwordDocIds, session));

    if (promises.length) {
      const results = await Promise.allSettled(promises);
      //I did it this way just to avoid having to edit the below working code
      if (results.some(x => x.status === 'rejected')) {
        throw `Error in fetchDocsForCache(): Promise.allSettled returned rejected promise(s)`;
      }


      let idx = 0;
      if (cosmosAddresses.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertAccountDoc(x as AccountDoc<NumberType>, BigIntify));
          for (const address of cosmosAddresses) {
            accountsData[address] = docs.find(x => x._legacyId === address);
          }
        }
      }

      if (collectionDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertCollectionDoc(x as CollectionDoc<NumberType>, BigIntify));
          for (const collectionId of collectionDocIds) {
            collectionData[collectionId] = docs.find(x => x._legacyId === collectionId);
          }
        }
      }

      if (balanceDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertBalanceDoc(x as BalanceDoc<NumberType>, BigIntify));
          for (const balanceId of balanceDocIds) {
            balanceData[balanceId] = docs.find(x => x._legacyId === balanceId);
          }
        }
      }

      if (claimDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertMerkleChallengeDoc(x as MerkleChallengeDoc<NumberType>, BigIntify));
          for (const claimId of claimDocIds) {
            claimData[claimId] = docs.find(x => x._legacyId === claimId);
          }
        }
      }

      if (addressMappingIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertAddressMappingDoc(x as AddressMappingDoc<NumberType>, BigIntify));
          for (const addressMappingId of addressMappingIds) {
            addressMappingsData[addressMappingId] = docs.find(x => x._legacyId === addressMappingId);
          }
        }
      }

      if (approvalsTrackerIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertApprovalsTrackerDoc(x as ApprovalsTrackerDoc<NumberType>, BigIntify));
          for (const approvalsTrackerId of approvalsTrackerIds) {
            approvalsTrackerData[approvalsTrackerId] = docs.find(x => x._legacyId === approvalsTrackerId);
          }
        }
      }

      if (passwordDocIds.length) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter(x => x).map((x) => convertPasswordDoc(x as PasswordDoc<NumberType>, BigIntify));
          for (const passwordDocId of passwordDocIds) {
            passwordDocs[passwordDocId] = docs.find(x => x._legacyId === passwordDocId);
          }
        }
      }
    }

    return { accounts: accountsData, collections: collectionData, balances: balanceData, merkleChallenges: claimData, approvalsTrackers: approvalsTrackerData, addressMappings: addressMappingsData, passwordDocs: passwordDocs }
  } catch (error) {
    throw `Error in fetchDocsForCache(): ${error}`;
  }
}

//Finalize docs at end of handling block(s)
export async function flushCachedDocs(docs: DocsCache, session?: mongoose.mongo.ClientSession, status?: StatusDoc<bigint>, skipStatusFlushIfEmptyBlock?: boolean) {
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
    const passwordDocs = Object.values(docs.passwordDocs) as (PasswordDoc<bigint>)[];
    const activityDocs = docs.activityToAdd;
    const queueDocs = docs.queueDocsToAdd;
    const claimAlertDocs = docs.claimAlertsToAdd;

    //If we have a session, we should not execute all inserts in parallel bc it messes up transactions
    //If not, we can execute all inserts in parallel
    const parallelExecution = !session;

    if (activityDocs.length) {
      if (parallelExecution) promises.push(insertMany(TransferActivityModel, activityDocs, session));
      else await insertMany(TransferActivityModel, activityDocs, session);
    }

    if (queueDocs.length) {
      if (parallelExecution) promises.push(insertMany(QueueModel, queueDocs, session));
      else await insertMany(QueueModel, queueDocs, session);
    }

    if (accountDocs.length) {
      if (parallelExecution) promises.push(insertMany(AccountModel, accountDocs, session));
      else await insertMany(AccountModel, accountDocs, session);
    }

    if (collectionDocs.length) {
      if (parallelExecution) promises.push(insertMany(CollectionModel, collectionDocs, session));
      else await insertMany(CollectionModel, collectionDocs, session);
    }

    if (balanceDocs.length) {
      if (parallelExecution) promises.push(insertMany(BalanceModel, balanceDocs, session));
      else await insertMany(BalanceModel, balanceDocs, session);
    }


    if (claimDocs.length) {
      if (parallelExecution) promises.push(insertMany(MerkleChallengeModel, claimDocs, session));
      else await insertMany(MerkleChallengeModel, claimDocs, session);
    }

    if (refreshDocs.length) {
      if (parallelExecution) promises.push(insertMany(RefreshModel, refreshDocs, session));
      else await insertMany(RefreshModel, refreshDocs, session);
    }

    if (approvalsTrackerDocs.length) {
      if (parallelExecution) promises.push(insertMany(ApprovalsTrackerModel, approvalsTrackerDocs, session));
      else await insertMany(ApprovalsTrackerModel, approvalsTrackerDocs, session);
    }

    if (addressMappingDocs.length) {
      if (parallelExecution) promises.push(insertMany(AddressMappingModel, addressMappingDocs, session));
      else await insertMany(AddressMappingModel, addressMappingDocs, session);
    }

    if (passwordDocs.length) {
      if (parallelExecution) promises.push(insertMany(PasswordModel, passwordDocs, session));
      else await insertMany(PasswordModel, passwordDocs, session);
    }

    if (claimAlertDocs.length) {
      if (parallelExecution) promises.push(insertMany(ClaimAlertModel, claimAlertDocs, session));
      else await insertMany(ClaimAlertModel, claimAlertDocs, session);
    }

    if (promises.length === 0 && status && skipStatusFlushIfEmptyBlock) {
      return false;
    } else if (promises.length || status) {
      if (status) {
        if (parallelExecution) promises.push(setStatus(status, session));
        else await setStatus(status, session);
      }

      if (parallelExecution) await Promise.all(promises);
    }

    return true;
  } catch (error) {

    await insertToDB(ErrorModel, {
      _legacyId: new mongoose.Types.ObjectId().toString(),
      function: 'flushCachedDocs',
      error: serializeError(error.message),
    });

    throw `Error in flushCachedDocs(): ${error}`;
  }
}
