import {
  type QueueDoc,
  type TransferActivityDoc,
  type ClaimAlertDoc,
  type ProtocolDoc,
  type UserProtocolCollectionsDoc,
  type ClaimBuilderDoc,
  type CollectionDoc,
  type RefreshDoc,
  type AccountDoc,
  type BalanceDoc,
  type MerkleChallengeDoc,
  type ApprovalTrackerDoc,
  type AddressListDoc
} from 'bitbadgesjs-sdk';

/**
 * DocsCache is used by the indexer to cache documents in memory to avoid having to fetch and write to the database each time.
 * Typically, all docs in the cache is cleared and written to the DB after each block is processed.
 */
export interface DocsCache {
  accounts: Record<string, AccountDoc<bigint> | undefined>;
  collections: Record<string, CollectionDoc<bigint> | undefined>;
  balances: Record<string, BalanceDoc<bigint> | undefined>;
  merkleChallenges: Record<string, MerkleChallengeDoc<bigint> | undefined>;
  refreshes: Record<string, RefreshDoc<bigint> | undefined>;
  approvalTrackers: Record<string, ApprovalTrackerDoc<bigint> | undefined>;
  addressLists: Record<string, AddressListDoc<bigint> | undefined>;
  queueDocsToAdd: Array<QueueDoc<bigint>>;
  activityToAdd: Array<TransferActivityDoc<bigint>>;
  claimAlertsToAdd: Array<ClaimAlertDoc<bigint>>;
  claimBuilderDocs: Record<string, ClaimBuilderDoc<bigint> | undefined>;

  protocols: Record<string, ProtocolDoc | undefined>;
  userProtocolCollections: Record<string, UserProtocolCollectionsDoc<bigint> | undefined>;
}

export type AccountDocs = Record<string, AccountDoc<bigint> | undefined>;
export type CollectionDocs = Record<string, CollectionDoc<bigint> | undefined>;
export type BalanceDocs = Record<string, BalanceDoc<bigint> | undefined>;
export type MerkleChallengeDocs = Record<string, MerkleChallengeDoc<bigint> | undefined>;
export type RefreshDocs = Record<string, RefreshDoc<bigint> | undefined>;
export type ApprovalTrackerDocs = Record<string, ApprovalTrackerDoc<bigint> | undefined>;
export type AddressListsDocs = Record<string, AddressListDoc<bigint> | undefined>;
export type ClaimBuilderDocs = Record<string, ClaimBuilderDoc<bigint> | undefined>;

export type ProtocolDocs = Record<string, ProtocolDoc | undefined>;
export type UserProtocolCollectionsDocs = Record<string, UserProtocolCollectionsDoc<bigint> | undefined>;
