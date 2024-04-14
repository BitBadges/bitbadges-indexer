import {
  type AccountDoc,
  type AddressListDoc,
  type ApprovalTrackerDoc,
  type BalanceDoc,
  type CollectionDoc,
  ListActivityDoc,
  type MerkleChallengeDoc,
  type NumberType,
  type ClaimBuilderDoc,
  type RefreshDoc,
  type StatusDoc,
  convertToCosmosAddress,
  MapDoc
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { handleFollowsByBalanceDocId } from '../routes/follows';
import { setStatus } from './status';
import {
  type AccountDocs,
  type AddressListsDocs,
  type ApprovalTrackerDocs,
  type BalanceDocs,
  type CollectionDocs,
  type DocsCache,
  type MerkleChallengeDocs,
  type ClaimBuilderDocs,
  MapDocs
} from './types';
import { getManyFromDB, insertMany, insertToDB } from './db';
import {
  AccountModel,
  CollectionModel,
  BalanceModel,
  MerkleChallengeModel,
  ApprovalTrackerModel,
  AddressListModel,
  ClaimBuilderModel,
  TransferActivityModel,
  QueueModel,
  FollowDetailsModel,
  RefreshModel,
  ListActivityModel,
  ClaimAlertModel,
  ErrorModel,
  MapModel
} from './schemas';
import { findInDB } from './queries';

/**
 * Fetches docs from DB if they are not already in the docs cache
 *
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCacheIfEmpty(
  currDocs: DocsCache,
  cosmosAddresses: string[],
  collectionIds: bigint[],
  balanceIds: string[],
  challengeTrackers: string[],
  approvalTrackerIds: string[],
  addressListIds: string[],
  claimBuilderDocIds: string[],
  mapIds: string[],
  session?: mongoose.mongo.ClientSession
) {
  try {
    const newCollectionIds = collectionIds.map((x) => x.toString()).filter((id) => !currDocs.collections[id]); // collectionId as keys (string: `${collectionId}`)
    const newCosmosAddresses = cosmosAddresses.map((x) => x.toString()).filter((id) => !currDocs.collections[id]);
    const newApprovalTrackerIds = approvalTrackerIds.filter((id) => !currDocs.approvalTrackers[id]);
    const newAddressListIds = addressListIds.filter((id) => !currDocs.addressLists[id]);
    const newClaimBuilderDocIds = claimBuilderDocIds.filter((id) => !currDocs.claimBuilderDocs[id]);
    const newMapIds = mapIds.filter((id) => !currDocs.maps[id]);

    // Partitioned IDs (collectionId:___)
    const newBalanceIds = balanceIds.filter((id) => !currDocs.balances[id]);
    const newMerklechallengeTrackerIds = challengeTrackers.filter((id) => !currDocs.merkleChallenges[id]);

    if (
      newCollectionIds.length > 0 ||
      newBalanceIds.length > 0 ||
      newMerklechallengeTrackerIds.length > 0 ||
      newCosmosAddresses.length > 0 ||
      newApprovalTrackerIds.length > 0 ||
      newAddressListIds.length > 0 ||
      newClaimBuilderDocIds.length > 0 ||
      newMapIds.length > 0
    ) {
      const newDocs = await fetchDocsForCache(
        newCosmosAddresses,
        newCollectionIds,
        newBalanceIds,
        newMerklechallengeTrackerIds,
        newApprovalTrackerIds,
        newAddressListIds,
        newClaimBuilderDocIds,
        newMapIds,
        session
      );
      currDocs.accounts = {
        ...currDocs.accounts,
        ...newDocs.accounts
      };

      currDocs.claimBuilderDocs = {
        ...currDocs.claimBuilderDocs,
        ...newDocs.claimBuilderDocs
      };

      currDocs.collections = {
        ...currDocs.collections,
        ...newDocs.collections
      };

      currDocs.balances = {
        ...currDocs.balances,
        ...newDocs.balances
      };
      currDocs.merkleChallenges = {
        ...currDocs.merkleChallenges,
        ...newDocs.merkleChallenges
      };
      currDocs.approvalTrackers = {
        ...currDocs.approvalTrackers,
        ...newDocs.approvalTrackers
      };
      currDocs.addressLists = {
        ...currDocs.addressLists,
        ...newDocs.addressLists
      };
      // Within the poller, we never require fetching a refresh doc (only adding new ones)
      // currDocs.refreshes = currDocs.refreshes
      // currDocs.claimAlertsToAdd = currDocs.claimAlertsToAdd
      // currDocs.activityToAdd = currDocs.activityToAdd
      // currDocs.queueDocsToAdd = currDocs.queueDocsToAdd

      currDocs.maps = {
        ...currDocs.maps,
        ...newDocs.maps
      };
    }
  } catch (error) {
    throw new Error(`Error in fetchDocsForCacheIfEmpty(): ${error}`);
  }
}

/**
 * Fetches the docs with the provided IDs from each respective DB.
 *
 * Assumes that all IDs are valid and filters out invalid IDs. If an ID is invalid, it will not be fetched or may throw an error.
 */
export async function fetchDocsForCache(
  _cosmosAddresses: string[],
  _collectionDocIds: string[],
  _balanceDocIds: string[],
  _claimDocIds: string[],
  _approvalTrackerIds: string[],
  _addressListIds: string[],
  _claimBuilderDocIds: string[],
  _mapIds: string[],
  session?: mongoose.mongo.ClientSession
) {
  try {
    const cosmosAddresses = [...new Set(_cosmosAddresses)].filter((id) => id.length > 0);
    const collectionDocIds = [...new Set(_collectionDocIds)].filter((id) => id.length > 0);
    const balanceDocIds = [...new Set(_balanceDocIds)].filter((id) => id.length > 0);
    const claimDocIds = [...new Set(_claimDocIds)].filter((id) => id.length > 0);
    const approvalTrackerIds = [...new Set(_approvalTrackerIds)].filter((id) => id.length > 0);
    const addressListIds = [...new Set(_addressListIds)].filter((id) => id.length > 0);
    const claimBuilderDocIds = [...new Set(_claimBuilderDocIds)].filter((id) => id.length > 0);
    const mapIds = [...new Set(_mapIds)].filter((id) => id.length > 0);

    console.log(
      _cosmosAddresses,
      _collectionDocIds,
      _balanceDocIds,
      _claimDocIds,
      _approvalTrackerIds,
      _addressListIds,
      _claimBuilderDocIds,
      _mapIds
    );

    const accountsData: AccountDocs = {};
    const collectionData: CollectionDocs = {};
    const balanceData: BalanceDocs = {};
    const claimData: MerkleChallengeDocs = {};
    const approvalTrackerData: ApprovalTrackerDocs = {};
    const addressListsData: AddressListsDocs = {};
    const claimBuilderDocs: ClaimBuilderDocs = {};
    const mapsData: MapDocs = {};

    const promises = [];
    if (cosmosAddresses.length > 0) promises.push(getManyFromDB(AccountModel, cosmosAddresses, session));
    if (collectionDocIds.length > 0) promises.push(getManyFromDB(CollectionModel, collectionDocIds, session));
    if (balanceDocIds.length > 0) promises.push(getManyFromDB(BalanceModel, balanceDocIds, session));
    if (claimDocIds.length > 0) promises.push(getManyFromDB(MerkleChallengeModel, claimDocIds, session));
    if (approvalTrackerIds.length > 0) promises.push(getManyFromDB(ApprovalTrackerModel, approvalTrackerIds, session));
    if (addressListIds.length > 0) promises.push(getManyFromDB(AddressListModel, addressListIds, session));
    if (claimBuilderDocIds.length > 0) promises.push(getManyFromDB(ClaimBuilderModel, claimBuilderDocIds, session));
    if (mapIds.length > 0) promises.push(getManyFromDB(MapModel, mapIds, session));

    if (promises.length > 0) {
      const results = await Promise.allSettled(promises);
      // I did it this way just to avoid having to edit the below working code
      if (results.some((x) => x.status === 'rejected')) {
        throw new Error('Error in fetchDocsForCache(): Promise.all returned a rejected promise');
      }

      let idx = 0;
      if (cosmosAddresses.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const address of cosmosAddresses) {
            accountsData[address] = docs.find((x) => x._docId === address);
          }
        }
      }

      if (collectionDocIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const collectionId of collectionDocIds) {
            collectionData[collectionId] = docs.find((x) => x._docId === collectionId);
          }
        }
      }

      if (balanceDocIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const balanceId of balanceDocIds) {
            balanceData[balanceId] = docs.find((x) => x._docId === balanceId);
          }
        }
      }

      if (claimDocIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const claimId of claimDocIds) {
            claimData[claimId] = docs.find((x) => x._docId === claimId);
          }
        }
      }

      if (addressListIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const addressListId of addressListIds) {
            addressListsData[addressListId] = docs.find((x) => x._docId === addressListId);
          }
        }
      }

      if (approvalTrackerIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const approvalTrackerId of approvalTrackerIds) {
            approvalTrackerData[approvalTrackerId] = docs.find((x) => x._docId === approvalTrackerId);
          }
        }
      }

      if (claimBuilderDocIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const claimBuilderDocId of claimBuilderDocIds) {
            claimBuilderDocs[claimBuilderDocId] = docs.find((x) => x._docId === claimBuilderDocId);
          }
        }
      }

      if (mapIds.length > 0) {
        const result = results[idx++];
        if (result.status === 'fulfilled') {
          const docs = (result.value as any[]).filter((x) => x);
          for (const mapId of mapIds) {
            mapsData[mapId] = docs.find((x) => x._docId === mapId);
          }
        }
      }
    }

    return {
      accounts: accountsData,
      collections: collectionData,
      balances: balanceData,
      merkleChallenges: claimData,
      approvalTrackers: approvalTrackerData,
      addressLists: addressListsData,
      claimBuilderDocs,
      maps: mapsData
    };
  } catch (error) {
    throw new Error(`Error in fetchDocsForCache(): ${error}`);
  }
}

// Finalize docs at end of handling block(s)
export async function flushCachedDocs(
  docs: DocsCache,
  session?: mongoose.mongo.ClientSession,
  status?: StatusDoc<bigint>,
  skipStatusFlushIfEmptyBlock?: boolean
) {
  try {
    // If we reach here, we assume that all docs are valid and ready to be inserted into the DB (i.e. not undefined) so we can cast safely
    const promises = [];
    const accountDocs = Object.values(docs.accounts) as Array<AccountDoc<bigint>>;
    const collectionDocs = Object.values(docs.collections) as Array<CollectionDoc<bigint>>;
    const balanceDocs = Object.values(docs.balances) as Array<BalanceDoc<bigint>>;
    const claimDocs = Object.values(docs.merkleChallenges) as Array<MerkleChallengeDoc<bigint>>;
    const refreshDocs = Object.values(docs.refreshes) as Array<RefreshDoc<bigint>>;
    const approvalTrackerDocs = Object.values(docs.approvalTrackers) as Array<ApprovalTrackerDoc<bigint>>;
    const addressListDocs = Object.values(docs.addressLists) as Array<AddressListDoc<bigint>>;
    const claimBuilderDocs = Object.values(docs.claimBuilderDocs) as Array<ClaimBuilderDoc<bigint>>;
    const activityDocs = docs.activityToAdd;
    const queueDocs = docs.queueDocsToAdd;
    const claimAlertDocs = docs.claimAlertsToAdd;
    const mapDocs = Object.values(docs.maps) as Array<MapDoc<bigint>>;

    // If we have a session, we should not execute all inserts in parallel bc it messes up transactions
    // If not, we can execute all inserts in parallel
    const parallelExecution = !session;

    if (activityDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(TransferActivityModel, activityDocs, session));
      else await insertMany(TransferActivityModel, activityDocs, session);
    }

    if (queueDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(QueueModel, queueDocs, session));
      else await insertMany(QueueModel, queueDocs, session);
    }

    if (accountDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(AccountModel, accountDocs, session));
      else await insertMany(AccountModel, accountDocs, session);
    }

    if (collectionDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(CollectionModel, collectionDocs, session));
      else await insertMany(CollectionModel, collectionDocs, session);
    }

    if (balanceDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(BalanceModel, balanceDocs, session));
      else await insertMany(BalanceModel, balanceDocs, session);

      // Check if any user has this balance as their followingCollectionId
      // If not, we do not have to handle follows
      const emptyCollections: bigint[] = [];
      for (const doc of balanceDocs) {
        if (emptyCollections.includes(doc.collectionId)) continue;

        const users = await findInDB(FollowDetailsModel, {
          query: { followingCollectionId: Number(doc.collectionId) }
        });
        if (users.length === 0) {
          emptyCollections.push(doc.collectionId);
          continue;
        }

        await handleFollowsByBalanceDocId(doc._docId, []);
      }
    }

    if (claimDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(MerkleChallengeModel, claimDocs, session));
      else await insertMany(MerkleChallengeModel, claimDocs, session);
    }

    if (refreshDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(RefreshModel, refreshDocs, session));
      else await insertMany(RefreshModel, refreshDocs, session);
    }

    if (approvalTrackerDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(ApprovalTrackerModel, approvalTrackerDocs, session));
      else await insertMany(ApprovalTrackerModel, approvalTrackerDocs, session);
    }

    if (addressListDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(AddressListModel, addressListDocs, session));
      else await insertMany(AddressListModel, addressListDocs, session);

      // We can do this bc on-chain lists are permanent and non-updatable
      const listActivityDocs: Array<ListActivityDoc<NumberType>> = [];
      for (const doc of addressListDocs) {
        if (doc.addresses.length == 0) continue;
        listActivityDocs.push(
          new ListActivityDoc({
            _docId: crypto.randomBytes(16).toString('hex'),
            addresses: doc.addresses.map((x) => convertToCosmosAddress(x)),
            addedToList: true,
            listId: doc.listId,
            timestamp: status?.block.timestamp ?? BigInt(Date.now()),
            block: status?.block.height ?? 0n
          })
        );
      }

      if (parallelExecution) promises.push(insertMany(ListActivityModel, listActivityDocs, session));
      else await insertMany(ListActivityModel, listActivityDocs, session);
    }

    if (claimBuilderDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(ClaimBuilderModel, claimBuilderDocs, session));
      else await insertMany(ClaimBuilderModel, claimBuilderDocs, session);
    }

    if (claimAlertDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(ClaimAlertModel, claimAlertDocs, session));
      else await insertMany(ClaimAlertModel, claimAlertDocs, session);
    }

    if (mapDocs.length > 0) {
      if (parallelExecution) promises.push(insertMany(MapModel, mapDocs, session));
      else await insertMany(MapModel, mapDocs, session);
    }

    if (promises.length === 0 && status && skipStatusFlushIfEmptyBlock) {
      return false;
    } else if (promises.length > 0 || status) {
      if (status) {
        if (parallelExecution) promises.push(setStatus(status, session));
        else await setStatus(status, session);
      }

      if (parallelExecution) await Promise.all(promises);
    }

    return true;
  } catch (error) {
    await insertToDB(ErrorModel, {
      _docId: new mongoose.Types.ObjectId().toString(),
      errorMessage: 'Error in flushCachedDocs()',
      function: 'flushCachedDocs',
      error: serializeError(error.message)
    });

    throw new Error(`Error in flushCachedDocs(): ${error}`);
  }
}
