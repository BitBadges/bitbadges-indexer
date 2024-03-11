/* eslint-disable @typescript-eslint/comma-dangle */
import {
  type AccountDoc,
  type ActivityDoc,
  type AddressListDoc,
  type AirdropDoc,
  type ApprovalTrackerDoc,
  type BalanceDoc,
  type BlockinAuthSignatureDoc,
  type ClaimAlertDoc,
  type CollectionDoc,
  type ComplianceDoc,
  type ErrorDoc,
  type FetchDoc,
  type FollowDetailsDoc,
  type IPFSTotalsDoc,
  type ListActivityDoc,
  type MerkleChallengeDoc,
  type NumberType,
  type ClaimBuilderDoc,
  type ProfileDoc,
  type ProtocolDoc,
  type QueueDoc,
  type RefreshDoc,
  type ReviewDoc,
  type StatusDoc,
  type TransferActivityDoc,
  type UserProtocolCollectionsDoc,
  type iAccountDoc,
  type iAddressListDoc,
  type iAirdropDoc,
  type iApprovalTrackerDoc,
  type iBalanceDoc,
  type iBlockinAuthSignatureDoc,
  type iClaimAlertDoc,
  type iCollectionDoc,
  type iComplianceDoc,
  type iFetchDoc,
  type iFollowDetailsDoc,
  type iIPFSTotalsDoc,
  type iListActivityDoc,
  type iMerkleChallengeDoc,
  type iClaimBuilderDoc,
  type iProfileDoc,
  type iProtocolDoc,
  type iQueueDoc,
  type iRefreshDoc,
  type iReviewDoc,
  type iStatusDoc,
  type iTransferActivityDoc,
  type iUserProtocolCollectionsDoc,
  type JSPrimitiveNumberType
} from 'bitbadgesjs-sdk';
import mongoose from 'mongoose';
import {
  type BrowseDoc,
  type ApiKeyDoc,
  type PageVisitsDoc,
  type EthTxCountDoc,
  type OffChainUrlDoc,
  type ReportDoc,
  type iBrowseDoc,
  type iPageVisitsDoc
} from './docs';

const { Schema } = mongoose;

export const ProtocolSchema = new Schema<ProtocolDoc>({
  _docId: String,
  name: String,
  uri: String,
  customData: String,
  createdBy: String,
  isFrozen: Boolean
});

export const UserProtocolCollectionsSchema = new Schema<UserProtocolCollectionsDoc<JSPrimitiveNumberType>>({
  _docId: String,
  protocols: Schema.Types.Mixed
});

export const CollectionSchema = new Schema<CollectionDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed,
  collectionMetadataTimeline: [Schema.Types.Mixed],
  badgeMetadataTimeline: [Schema.Types.Mixed],
  balancesType: String,
  offChainBalancesMetadataTimeline: [Schema.Types.Mixed],
  customDataTimeline: [Schema.Types.Mixed],
  managerTimeline: [Schema.Types.Mixed],
  collectionPermissions: Schema.Types.Mixed,
  collectionApprovals: [Schema.Types.Mixed],
  standardsTimeline: [Schema.Types.Mixed],
  isArchivedTimeline: [Schema.Types.Mixed],
  defaultBalances: Schema.Types.Mixed,
  createdBy: String, // Not set as Mixed, as you mentioned it can be a string
  createdBlock: Schema.Types.Mixed,
  createdTimestamp: Schema.Types.Mixed,
  updateHistory: [Schema.Types.Mixed],
  aliasAddress: String // Not set as Mixed, as you mentioned it can be a string
});

export const AccountSchema = new Schema<AccountDoc<JSPrimitiveNumberType>>({
  _docId: String,
  publicKey: String, // String type for publicKey
  pubKeyType: String, // String type for pubKeyType
  cosmosAddress: String, // String type for cosmosAddress
  ethAddress: String, // String type for ethAddress
  solAddress: String, // String type for solAddress
  btcAddress: String, // String type for btcAddress
  accountNumber: Schema.Types.Mixed, // Mixed type for accountNumber (number type)

  // Dynamically fetched fields
  sequence: Schema.Types.Mixed, // Mixed type for sequence (number type)
  balance: Schema.Types.Mixed // Mixed type for balance (CosmosCoin type or other)

  // Add any other fields as needed
});

export const ProfileSchema = new Schema<ProfileDoc<JSPrimitiveNumberType>>({
  _docId: String,
  fetchedProfile: Boolean, // Boolean type for fetchedProfile
  seenActivity: Schema.Types.Mixed, // Mixed type for seenActivity (number type)
  createdAt: Schema.Types.Mixed, // Mixed type for createdAt (number type)
  discord: String, // String type for discord
  twitter: String, // String type for twitter
  github: String, // String type for github
  telegram: String, // String type for telegram
  readme: String, // String type for readme
  customLinks: [Schema.Types.Mixed], // Array of CustomLink
  hiddenBadges: [
    {
      collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
      badgeIds: [
        {
          /* Define the structure of UintRange here */
        }
      ] // Array of UintRange
    }
  ],
  hiddenLists: [String], // Array of string
  customPages: Schema.Types.Mixed, // Array of CustomPage
  watchlists: Schema.Types.Mixed, // Array of Watchlist

  profilePicUrl: String, // String type for profilePicUrl
  username: String, // String type for username
  latestSignedInChain: String, // String type for latestSignedInChain
  solAddress: String, // String type for solAddress
  notifications: Schema.Types.Mixed, // Notification details
  approvedSignInMethods: Schema.Types.Mixed // Sign in details
});

export const QueueSchema = new Schema<QueueDoc<JSPrimitiveNumberType>>({
  _docId: String,
  uri: String, // String type for uri
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  loadBalanceId: Schema.Types.Mixed, // Mixed type for loadBalanceId (number type)
  refreshRequestTime: Schema.Types.Mixed, // Mixed type for refreshRequestTime (number type)
  numRetries: Schema.Types.Mixed, // Mixed type for numRetries (number type)
  lastFetchedAt: Schema.Types.Mixed, // Mixed type for lastFetchedAt (number type)
  error: String, // String type for error
  deletedAt: Schema.Types.Mixed, // Mixed type for deletedAt (number type)
  nextFetchTime: Schema.Types.Mixed, // Mixed type for nextFetchTime (number type)

  emailMessage: String, // String type for emailMessage
  recipientAddress: String, // String type for recipientAddress
  activityDocId: String, // String type for activityDocId
  notificationType: String // String type for notificationType
});

export const StatusSchema = new Schema<StatusDoc<JSPrimitiveNumberType>>({
  _docId: String,
  block: Schema.Types.Mixed, // Mixed type for block (number type)
  nextCollectionId: Schema.Types.Mixed, // Mixed type for nextCollectionId (number type)
  gasPrice: Number, // Number type for gasPrice
  lastXGasLimits: [Schema.Types.Mixed], // Array of Mixed type for lastXGasLimits (number type)
  lastXGasAmounts: [Schema.Types.Mixed] // Array of Mixed type for lastXGasAmounts (number type)
});

export const AddressListSchema = new Schema<AddressListDoc<JSPrimitiveNumberType>>({
  _docId: String,
  listId: String, // String type for listId
  addresses: [String], // Array of string for addresses
  whitelist: Boolean, // Boolean type for whitelist
  uri: String, // String type for uri
  customData: String, // String type for customData
  createdBy: String, // String type for createdBy
  aliasAddress: String, // String type for aliasAddress
  updateHistory: [Schema.Types.Mixed],
  createdBlock: Schema.Types.Mixed, // Mixed type for createdBlock (number type)
  lastUpdated: Schema.Types.Mixed, // Mixed type for lastUpdated (number type)
  private: Boolean, // Boolean type for private
  viewableWithLink: Boolean, // Boolean type for viewableWithLink
  nsfw: { reason: String }, // Object with string type property for nsfw
  reported: { reason: String } // Object with string type property for reported
});

export const BalanceSchema = new Schema<BalanceDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  cosmosAddress: String, // String type for cosmosAddress
  balances: [Schema.Types.Mixed], // Array of Mixed type for balances (UserBalance type)
  incomingApprovals: [Schema.Types.Mixed], // Array of Mixed type for incomingApprovals (UserIncomingApproval type)
  outgoingApprovals: [Schema.Types.Mixed], // Array of Mixed type for outgoingApprovals (UserOutgoingApproval type)
  autoApproveSelfInitiatedIncomingTransfers: Boolean, // Boolean type for autoApproveSelfInitiatedIncomingTransfers
  autoApproveSelfInitiatedOutgoingTransfers: Boolean, // Boolean type for autoApproveSelfInitiatedOutgoingTransfers
  userPermissions: Schema.Types.Mixed, // Mixed type for userPermissions (UserPermissions type)
  onChain: Boolean, // Boolean type for onChain
  uri: String, // String type for uri
  fetchedAt: Schema.Types.Mixed, // Mixed type for fetchedAt (number type)
  fetchedAtBlock: Schema.Types.Mixed, // Mixed type for fetchedAtBlock (number type)
  contentHash: String, // String type for contentHash
  isPermanent: Boolean, // Boolean type for isPermanent
  updateHistory: [Schema.Types.Mixed]
});

export const ClaimBuilderSchema = new Schema<ClaimBuilderDoc<JSPrimitiveNumberType>>({
  _docId: String,
  cid: String, // String type for cid
  createdBy: String, // String type for createdBy
  docClaimed: Boolean, // Boolean type for docClaimed
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  action: Schema.Types.Mixed, // Mixed type for action
  manualDistribution: Boolean, // Boolean type for manualDistribution
  state: Schema.Types.Mixed, // Mixed type for state
  plugins: [Schema.Types.Mixed] // Array of Mixed type for plugins (Plugin type)
});

export const ChallengeSchema = new Schema<MerkleChallengeDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  challengeId: String, // String type for challengeId
  challengeLevel: String, // String type for challengeLevel
  approverAddress: String, // String type for approverAddress
  usedLeafIndices: [Schema.Types.Mixed] // Array of Mixed type for usedLeafIndices (number type)
});

export const ApprovalTrackerSchema = new Schema<ApprovalTrackerDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  numTransfers: Schema.Types.Mixed, // Mixed type for numTransfers (number type)
  amounts: [Schema.Types.Mixed], // Array of Mixed type for amounts (Balance type)
  approvalLevel: String, // String type for approvalLevel
  approverAddress: String, // String type for approverAddress
  amountTrackerId: String, // String type for amountTrackerId
  trackerType: String, // String type for trackerType
  approvedAddress: String // String type for approvedAddress
});

export const FetchSchema = new Schema<FetchDoc<JSPrimitiveNumberType>>({
  _docId: String,
  content: Schema.Types.Mixed, // Mixed type for content
  fetchedAt: Schema.Types.Mixed, // Mixed type for fetchedAt (number type)
  fetchedAtBlock: Schema.Types.Mixed, // Mixed type for fetchedAtBlock (number type)
  db: String, // String type for db
  isPermanent: Boolean // Boolean type for isPermanent
});

export const RefreshSchema = new Schema<RefreshDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  refreshRequestTime: Schema.Types.Mixed // Mixed type for refreshRequestTime (number type)
});

export const AirdropSchema = new Schema<AirdropDoc<JSPrimitiveNumberType>>({
  _docId: String,
  airdropped: Boolean, // Boolean type for airdropped
  timestamp: Schema.Types.Mixed, // Mixed type for timestamp (number type)
  hash: String // String type for hash
});

export const IPFSTotalsSchema = new Schema<IPFSTotalsDoc<JSPrimitiveNumberType>>({
  _docId: String,
  bytesUploaded: Schema.Types.Mixed // Mixed type for bytesUploaded (number type)
});

export const ComplianceSchema = new Schema<ComplianceDoc<JSPrimitiveNumberType>>({
  _docId: String,
  badges: Schema.Types.Mixed, // Mixed type for badges
  addressLists: Schema.Types.Mixed, // Mixed type for addressLists
  accounts: Schema.Types.Mixed // Mixed type for accounts
});

export const BlockinAuthSignatureSchema = new Schema<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>({
  _docId: String,
  signature: String, // String type for signature
  name: String, // String type for name
  description: String, // String type for description
  image: String, // String type for image
  cosmosAddress: String, // String type for cosmosAddress
  params: Schema.Types.Mixed, // Mixed type for params (ChallengeParams type)
  createdAt: Schema.Types.Mixed, // Mixed type for createdAt (number type)
  deletedAt: Schema.Types.Mixed // Mixed type for deletedAt (number type)
});

export const FollowDetailsSchema = new Schema<FollowDetailsDoc<JSPrimitiveNumberType>>({
  _docId: String,
  cosmosAddress: String, // String type for cosmosAddress
  followingCount: Schema.Types.Mixed, // Mixed type for followingCount (number type)
  followersCount: Schema.Types.Mixed, // Mixed type for followersCount (number type)
  followingCollectionId: Schema.Types.Mixed, // Mixed type for followingCollectionId (number type)
  followers: Schema.Types.Mixed, // Mixed type for followers
  following: Schema.Types.Mixed // Mixed type for following
});

export const ListActivitySchema = new Schema<ListActivityDoc<JSPrimitiveNumberType>>({
  _docId: String,
  _notificationsHandled: Boolean,
  listId: String,
  addedToList: Boolean,
  addresses: [String],
  timestamp: Schema.Types.Mixed,
  block: Schema.Types.Mixed,
  txHash: String
});

export const TransferActivitySchema = new Schema<TransferActivityDoc<JSPrimitiveNumberType>>({
  _docId: String,
  to: [String],
  from: String,
  _notificationsHandled: Boolean,
  balances: [Schema.Types.Mixed],
  collectionId: Schema.Types.Mixed,
  timestamp: Schema.Types.Mixed,
  block: Schema.Types.Mixed,
  memo: String,
  precalculateBalancesFromApproval: Schema.Types.Mixed,
  prioritizedApprovals: [Schema.Types.Mixed],
  onlyCheckPrioritizedApprovals: Boolean,
  initiatedBy: String,
  txHash: String
});

export const ReviewSchema = new Schema<ReviewDoc<JSPrimitiveNumberType>>({
  _docId: String,
  review: String,
  stars: Schema.Types.Mixed,
  timestamp: Schema.Types.Mixed,
  block: Schema.Types.Mixed,
  from: String,
  collectionId: Schema.Types.Mixed,
  reviewedAddress: String
});

export const ClaimAlertSchema = new Schema<ClaimAlertDoc<JSPrimitiveNumberType>>({
  _docId: String,
  _notificationsHandled: Boolean,
  code: String, // String type for code
  cosmosAddresses: [String], // Array of string for cosmosAddresses
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  timestamp: Schema.Types.Mixed, // Mixed type for timestamp (number type)
  block: Schema.Types.Mixed, // Mixed type for block (number type)
  message: String // String type for message
});

export const PageVisitsSchema = new Schema({
  _docId: String,
  collectionId: Number,
  listId: String,
  overallVisits: Schema.Types.Mixed,
  badgePageVisits: Schema.Types.Mixed
});

export const BrowseSchema = new Schema({
  _docId: String,
  collections: Schema.Types.Mixed,
  addressLists: Schema.Types.Mixed,
  profiles: Schema.Types.Mixed,
  badges: Schema.Types.Mixed
});

export const ApiKeySchema = new Schema({
  _docId: String,
  numRequests: Number,
  lastRequest: Number
});

export const ErrorSchema = new Schema({
  error: Schema.Types.Mixed,
  _docId: String
});

export const OffChainUrlSchema = new Schema({
  collectionId: Number,
  _docId: String
});

export const ReportSchema = new Schema({
  _docId: String,
  collectionId: Number,
  listId: String,
  addressOrUsername: String,
  reason: String
});

export const EthTxCountSchema = new Schema({
  _docId: String,
  count: Number,
  lastFetched: Number
});

export interface UsernameDoc {
  _docId: string;
  _id: string;
}
export const UsernameSchema = new Schema({
  _docId: String
});

// set minimize to false to avoid issues with empty objects
ClaimBuilderSchema.set('minimize', false); // claimedUsers is {} by default

export const BrowseModel = mongoose.model<BrowseDoc<JSPrimitiveNumberType>>('browse', BrowseSchema);
export const ApiKeyModel = mongoose.model<ApiKeyDoc>('api-keys', ApiKeySchema);
export const FetchModel = mongoose.model<FetchDoc<JSPrimitiveNumberType>>('fetches', FetchSchema);
export const QueueModel = mongoose.model<QueueDoc<JSPrimitiveNumberType>>('queue', QueueSchema);
export const RefreshModel = mongoose.model<RefreshDoc<JSPrimitiveNumberType>>('refreshes', RefreshSchema);
export const StatusModel = mongoose.model<StatusDoc<JSPrimitiveNumberType>>('status', StatusSchema);
export const AccountModel = mongoose.model<AccountDoc<JSPrimitiveNumberType>>('accounts', AccountSchema);
export const CollectionModel = mongoose.model<CollectionDoc<JSPrimitiveNumberType>>('collections', CollectionSchema);
export const BalanceModel = mongoose.model<BalanceDoc<JSPrimitiveNumberType>>('balances', BalanceSchema);
export const MerkleChallengeModel = mongoose.model<MerkleChallengeDoc<JSPrimitiveNumberType>>('merkle-challenges', ChallengeSchema);
export const ClaimBuilderModel = mongoose.model<ClaimBuilderDoc<JSPrimitiveNumberType>>('passwords', ClaimBuilderSchema);
export const ProfileModel = mongoose.model<ProfileDoc<JSPrimitiveNumberType>>('profiles', ProfileSchema);
export const TransferActivityModel = mongoose.model<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activity', TransferActivitySchema);
export const ReviewModel = mongoose.model<ReviewDoc<JSPrimitiveNumberType>>('reviews', ReviewSchema);
export const IPFSTotalsModel = mongoose.model<IPFSTotalsDoc<JSPrimitiveNumberType>>('ipfs-totals', IPFSTotalsSchema);
export const AirdropModel = mongoose.model<AirdropDoc<JSPrimitiveNumberType>>('airdrop', AirdropSchema);
export const AddressListModel = mongoose.model<AddressListDoc<JSPrimitiveNumberType>>('address-lists', AddressListSchema);
export const ApprovalTrackerModel = mongoose.model<ApprovalTrackerDoc<JSPrimitiveNumberType>>('approvals-trackers', ApprovalTrackerSchema);
export const ClaimAlertModel = mongoose.model<ClaimAlertDoc<JSPrimitiveNumberType>>('claim-alerts', ClaimAlertSchema);
export const ComplianceModel = mongoose.model<ComplianceDoc<JSPrimitiveNumberType>>('compliance', ComplianceSchema);
export const BlockinAuthSignatureModel = mongoose.model<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>('auth-codes', BlockinAuthSignatureSchema);
export const FollowDetailsModel = mongoose.model<FollowDetailsDoc<JSPrimitiveNumberType>>('follows', FollowDetailsSchema);
export const ProtocolModel = mongoose.model<ProtocolDoc>('protocols', ProtocolSchema);
export const UserProtocolCollectionsModel = mongoose.model<UserProtocolCollectionsDoc<JSPrimitiveNumberType>>(
  'user-collection-protocols',
  UserProtocolCollectionsSchema
);
export const ListActivityModel = mongoose.model<ListActivityDoc<JSPrimitiveNumberType>>('list-activity', ListActivitySchema);
export const PageVisitsModel = mongoose.model<PageVisitsDoc<JSPrimitiveNumberType>>('page-visits', PageVisitsSchema);
export const ErrorModel = mongoose.model<ErrorDoc>('errors', ErrorSchema);
export const UsernameModel = mongoose.model<UsernameDoc>('usernames', UsernameSchema);
export const EthTxCountModel = mongoose.model<EthTxCountDoc>('eth-tx-count', EthTxCountSchema);
export const OffChainUrlModel = mongoose.model<OffChainUrlDoc>('off-chain-urls', OffChainUrlSchema);
export const ReportModel = mongoose.model<ReportDoc>('reports', ReportSchema);

export type TypedInterfaceFromModel<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends NumberType = bigint> =
  T extends StatusDoc<JSPrimitiveNumberType>
    ? iStatusDoc<U>
    : T extends AccountDoc<JSPrimitiveNumberType>
      ? iAccountDoc<U>
      : T extends CollectionDoc<JSPrimitiveNumberType>
        ? iCollectionDoc<U>
        : T extends BlockinAuthSignatureDoc<JSPrimitiveNumberType>
          ? iBlockinAuthSignatureDoc<U>
          : T extends BalanceDoc<JSPrimitiveNumberType>
            ? iBalanceDoc<U>
            : T extends MerkleChallengeDoc<JSPrimitiveNumberType>
              ? iMerkleChallengeDoc<U>
              : T extends FetchDoc<JSPrimitiveNumberType>
                ? iFetchDoc<U>
                : T extends QueueDoc<JSPrimitiveNumberType>
                  ? iQueueDoc<U>
                  : T extends RefreshDoc<JSPrimitiveNumberType>
                    ? iRefreshDoc<U>
                    : T extends ClaimBuilderDoc<JSPrimitiveNumberType>
                      ? iClaimBuilderDoc<U>
                      : T extends TransferActivityDoc<JSPrimitiveNumberType>
                        ? iTransferActivityDoc<U>
                        : T extends ReviewDoc<JSPrimitiveNumberType>
                          ? iReviewDoc<U>
                          : T extends IPFSTotalsDoc<JSPrimitiveNumberType>
                            ? iIPFSTotalsDoc<U>
                            : T extends AirdropDoc<JSPrimitiveNumberType>
                              ? iAirdropDoc<U>
                              : T extends AddressListDoc<JSPrimitiveNumberType>
                                ? iAddressListDoc<U>
                                : T extends ApprovalTrackerDoc<JSPrimitiveNumberType>
                                  ? iApprovalTrackerDoc<U>
                                  : T extends ClaimAlertDoc<JSPrimitiveNumberType>
                                    ? iClaimAlertDoc<U>
                                    : T extends ComplianceDoc<JSPrimitiveNumberType>
                                      ? iComplianceDoc<U>
                                      : T extends FollowDetailsDoc<JSPrimitiveNumberType>
                                        ? iFollowDetailsDoc<U>
                                        : T extends BrowseDoc<JSPrimitiveNumberType>
                                          ? iBrowseDoc<U>
                                          : T extends ProtocolDoc
                                            ? iProtocolDoc
                                            : T extends UserProtocolCollectionsDoc<JSPrimitiveNumberType>
                                              ? iUserProtocolCollectionsDoc<U>
                                              : T extends ListActivityDoc<JSPrimitiveNumberType>
                                                ? iListActivityDoc<U>
                                                : T extends PageVisitsDoc<JSPrimitiveNumberType>
                                                  ? iPageVisitsDoc<U>
                                                  : T extends ProfileDoc<JSPrimitiveNumberType>
                                                    ? iProfileDoc<U>
                                                    : T extends ErrorDoc
                                                      ? ErrorDoc
                                                      : T extends ApiKeyDoc
                                                        ? ApiKeyDoc
                                                        : T extends ReportDoc
                                                          ? ReportDoc
                                                          : T extends EthTxCountDoc
                                                            ? EthTxCountDoc
                                                            : T extends OffChainUrlDoc
                                                              ? OffChainUrlDoc
                                                              : T extends UsernameDoc
                                                                ? UsernameDoc
                                                                : never;

export type TypedDocFromModel<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends NumberType = bigint> =
  T extends StatusDoc<JSPrimitiveNumberType>
    ? StatusDoc<U>
    : T extends AccountDoc<JSPrimitiveNumberType>
      ? AccountDoc<U>
      : T extends CollectionDoc<JSPrimitiveNumberType>
        ? CollectionDoc<U>
        : T extends BalanceDoc<JSPrimitiveNumberType>
          ? BalanceDoc<U>
          : T extends MerkleChallengeDoc<JSPrimitiveNumberType>
            ? MerkleChallengeDoc<U>
            : T extends FetchDoc<JSPrimitiveNumberType>
              ? FetchDoc<U>
              : T extends QueueDoc<JSPrimitiveNumberType>
                ? QueueDoc<U>
                : T extends RefreshDoc<JSPrimitiveNumberType>
                  ? RefreshDoc<U>
                  : T extends BlockinAuthSignatureDoc<JSPrimitiveNumberType>
                    ? BlockinAuthSignatureDoc<U>
                    : T extends ClaimBuilderDoc<JSPrimitiveNumberType>
                      ? ClaimBuilderDoc<U>
                      : T extends TransferActivityDoc<JSPrimitiveNumberType>
                        ? TransferActivityDoc<U>
                        : T extends ReviewDoc<JSPrimitiveNumberType>
                          ? ReviewDoc<U>
                          : T extends IPFSTotalsDoc<JSPrimitiveNumberType>
                            ? IPFSTotalsDoc<U>
                            : T extends AirdropDoc<JSPrimitiveNumberType>
                              ? AirdropDoc<U>
                              : T extends AddressListDoc<JSPrimitiveNumberType>
                                ? AddressListDoc<U>
                                : T extends ApprovalTrackerDoc<JSPrimitiveNumberType>
                                  ? ApprovalTrackerDoc<U>
                                  : T extends ClaimAlertDoc<JSPrimitiveNumberType>
                                    ? ClaimAlertDoc<U>
                                    : T extends ComplianceDoc<JSPrimitiveNumberType>
                                      ? ComplianceDoc<U>
                                      : T extends FollowDetailsDoc<JSPrimitiveNumberType>
                                        ? FollowDetailsDoc<U>
                                        : T extends BrowseDoc<JSPrimitiveNumberType>
                                          ? BrowseDoc<U>
                                          : T extends ProtocolDoc
                                            ? ProtocolDoc
                                            : T extends UserProtocolCollectionsDoc<JSPrimitiveNumberType>
                                              ? UserProtocolCollectionsDoc<U>
                                              : T extends ListActivityDoc<JSPrimitiveNumberType>
                                                ? ListActivityDoc<U>
                                                : T extends PageVisitsDoc<JSPrimitiveNumberType>
                                                  ? PageVisitsDoc<U>
                                                  : T extends ProfileDoc<JSPrimitiveNumberType>
                                                    ? ProfileDoc<U>
                                                    : T extends ApiKeyDoc
                                                      ? ApiKeyDoc
                                                      : T extends ErrorDoc
                                                        ? ErrorDoc
                                                        : T extends ReportDoc
                                                          ? ReportDoc
                                                          : T extends EthTxCountDoc
                                                            ? EthTxCountDoc
                                                            : T extends OffChainUrlDoc
                                                              ? OffChainUrlDoc
                                                              : T extends UsernameDoc
                                                                ? UsernameDoc
                                                                : never;

export type BitBadgesDoc<T extends NumberType> =
  | TransferActivityDoc<T>
  | ReviewDoc<T>
  | ActivityDoc<T>
  | ProfileDoc<T>
  | AccountDoc<T>
  | CollectionDoc<T>
  | StatusDoc<T>
  | ClaimBuilderDoc<T>
  | BalanceDoc<T>
  | MerkleChallengeDoc<T>
  | FetchDoc<T>
  | QueueDoc<T>
  | RefreshDoc<T>
  | IPFSTotalsDoc<T>
  | ErrorDoc
  | AirdropDoc<T>
  | ApprovalTrackerDoc<T>
  | AddressListDoc<T>
  | ApiKeyDoc
  | ClaimAlertDoc<T>
  | EthTxCountDoc
  | OffChainUrlDoc
  | ReportDoc
  | ComplianceDoc<T>
  | BlockinAuthSignatureDoc<T>
  | FollowDetailsDoc<T>
  | BrowseDoc<T>
  | ProtocolDoc
  | UserProtocolCollectionsDoc<T>
  | ListActivityDoc<T>
  | PageVisitsDoc<T>
  | UsernameDoc;
export type iBitBadgesDoc<T extends NumberType> =
  | iTransferActivityDoc<T>
  | iReviewDoc<T>
  | iTransferActivityDoc<T>
  | iProfileDoc<T>
  | iAccountDoc<T>
  | iCollectionDoc<T>
  | iStatusDoc<T>
  | iClaimBuilderDoc<T>
  | iBalanceDoc<T>
  | iMerkleChallengeDoc<T>
  | iFetchDoc<T>
  | iQueueDoc<T>
  | iRefreshDoc<T>
  | iIPFSTotalsDoc<T>
  | ErrorDoc
  | iAirdropDoc<T>
  | iApprovalTrackerDoc<T>
  | iAddressListDoc<T>
  | ApiKeyDoc
  | iClaimAlertDoc<T>
  | EthTxCountDoc
  | OffChainUrlDoc
  | ReportDoc
  | iComplianceDoc<T>
  | iBlockinAuthSignatureDoc<T>
  | iFollowDetailsDoc<T>
  | BrowseDoc<T>
  | iProtocolDoc
  | iUserProtocolCollectionsDoc<T>
  | iListActivityDoc<T>
  | iPageVisitsDoc<T>
  | UsernameDoc;
