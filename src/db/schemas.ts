/* eslint-disable @typescript-eslint/comma-dangle */
import {
  AccessTokenDoc,
  AttestationProofDoc,
  AuthorizationCodeDoc,
  DeveloperAppDoc,
  PluginDoc,
  iAccessTokenDoc,
  iAttestationProofDoc,
  iAuthorizationCodeDoc,
  iDeveloperAppDoc,
  iPluginDoc,
  type AccountDoc,
  type ActivityDoc,
  type AddressListDoc,
  type AirdropDoc,
  type ApprovalTrackerDoc,
  type AttestationDoc,
  type BalanceDoc,
  type ClaimAlertDoc,
  type ClaimBuilderDoc,
  type CollectionDoc,
  type ComplianceDoc,
  type ErrorDoc,
  type FetchDoc,
  type FollowDetailsDoc,
  type IPFSTotalsDoc,
  type JSPrimitiveNumberType,
  type ListActivityDoc,
  type MapDoc,
  type MerkleChallengeDoc,
  type NumberType,
  type ProfileDoc,
  type QueueDoc,
  type RefreshDoc,
  type ReviewDoc,
  type SIWBBRequestDoc,
  type StatusDoc,
  type TransferActivityDoc,
  type iAccountDoc,
  type iAddressListDoc,
  type iAirdropDoc,
  type iApprovalTrackerDoc,
  type iAttestationDoc,
  type iBalanceDoc,
  type iClaimAlertDoc,
  type iClaimBuilderDoc,
  type iCollectionDoc,
  type iComplianceDoc,
  type iFetchDoc,
  type iFollowDetailsDoc,
  type iIPFSTotalsDoc,
  type iListActivityDoc,
  type iMapDoc,
  type iMerkleChallengeDoc,
  type iProfileDoc,
  type iQueueDoc,
  type iRefreshDoc,
  type iReviewDoc,
  type iSIWBBRequestDoc,
  type iStatusDoc,
  type iTransferActivityDoc
} from 'bitbadgesjs-sdk';
import mongoose from 'mongoose';
import {
  DigitalOceanBalancesDoc,
  iDigitalOceanBalancesDoc,
  type ApiKeyDoc,
  type BrowseDoc,
  type EthTxCountDoc,
  type OffChainUrlDoc,
  type PageVisitsDoc,
  type ReportDoc,
  type iBrowseDoc,
  type iPageVisitsDoc
} from './docs';

const { Schema } = mongoose;

export interface KeysDoc {
  _id?: string;
  _docId: string;
  keys: Array<{ key: string; timestamp: number }>;
}

export const AuthorizationCodeSchema = new Schema<AuthorizationCodeDoc>({
  _docId: String,
  clientId: String,
  redirectUri: String,
  scopes: Schema.Types.Mixed,
  address: String,
  cosmosAddress: String,
  expiresAt: Number
});

export const AccessTokenSchema = new Schema<AccessTokenDoc>({
  _docId: String,
  accessToken: String,
  tokenType: String,
  accessTokenExpiresAt: Number,
  refreshTokenExpiresAt: Number,
  refreshToken: String,
  cosmosAddress: String,
  address: String,
  clientId: String,
  scopes: Schema.Types.Mixed
});

export const PluginSchema = new Schema<PluginDoc<JSPrimitiveNumberType>>({
  _docId: String,
  pluginId: String,
  pluginSecret: String,
  reviewCompleted: Boolean,
  createdBy: String,
  stateFunctionPreset: String,
  duplicatesAllowed: Boolean,
  requiresSessions: Boolean,
  requiresUserInputs: Boolean,
  reuseForNonIndexed: Boolean,
  reuseForLists: Boolean,
  userInputRedirect: Schema.Types.Mixed,
  claimCreatorRedirect: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed,
  userInputsSchema: [Schema.Types.Mixed],
  publicParamsSchema: [Schema.Types.Mixed],
  privateParamsSchema: [Schema.Types.Mixed],
  verificationCall: Schema.Types.Mixed,
  lastUpdated: Number,
  createdAt: Number,
  deletedAt: Number,
  toPublish: Boolean,
  approvedUsers: [String]
});

export const MapSchema = new Schema<MapDoc<JSPrimitiveNumberType>>({
  _docId: String,
  _id: String,
  values: Schema.Types.Mixed,
  creator: String,
  mapId: String,
  inheritManagerTimelineFrom: Schema.Types.Mixed,
  managerTimeline: Schema.Types.Mixed,
  updateCriteria: Schema.Types.Mixed,
  valueOptions: Schema.Types.Mixed,
  defaultValue: String,
  permissions: Schema.Types.Mixed,
  metadataTimeline: Schema.Types.Mixed,
  updateHistory: [Schema.Types.Mixed]
});

export const OffChainAttestationsSchema = new Schema<AttestationDoc<JSPrimitiveNumberType>>({
  _docId: String,
  createdAt: Schema.Types.Mixed,
  createdBy: String,
  addKey: String,
  attestationId: String,
  type: String,
  scheme: String,
  attestationMessages: [String],
  dataIntegrityProof: Schema.Types.Mixed,
  holders: [String],
  name: String,
  image: String,
  description: String,
  updateHistory: [Schema.Types.Mixed],
  anchors: [Schema.Types.Mixed],
  proofOfIssuance: Schema.Types.Mixed,
  messageFormat: String
});

export const AttestationProofSchema = new Schema<AttestationProofDoc<JSPrimitiveNumberType>>({
  _docId: String,
  _id: String,
  entropies: [String],
  updateHistory: [Schema.Types.Mixed],
  messageFormat: String,
  createdBy: String,
  createdAt: Number,
  proofOfIssuance: Schema.Types.Mixed,
  scheme: String,
  attestationMessages: [String],
  dataIntegrityProof: Schema.Types.Mixed,
  name: String,
  image: String,
  displayOnProfile: Boolean,
  description: String
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
  socialConnections: Schema.Types.Mixed, // Social connections
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
  claimInfo: Schema.Types.Mixed, // Mixed type for claimInfo
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
  approach: String,
  state: Schema.Types.Mixed, // Mixed type for state
  deletedAt: Schema.Types.Mixed, // Mixed type for deletedAt (number type)
  metadata: Schema.Types.Mixed, // Mixed type for metadata
  trackerDetails: Schema.Types.Mixed, // Mixed type for trackerDetails (ChallengeTrackerIdDetails type)
  lastUpdated: Schema.Types.Mixed, // Mixed type for lastUpdated (number type)
  createdAt: Schema.Types.Mixed, // Mixed type for createdAt (number type)
  assignMethod: String, // String type for assignMethod
  plugins: [Schema.Types.Mixed] // Array of Mixed type for plugins (Plugin type)
});

export const ChallengeSchema = new Schema<MerkleChallengeDoc<JSPrimitiveNumberType>>({
  _docId: String,
  collectionId: Schema.Types.Mixed, // Mixed type for collectionId (number type)
  approvalId: String, // String type for approvalId
  challengeTrackerId: String, // String type for challengeTrackerId
  approvalLevel: String, // String type for approvalLevel
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
  approvalId: String, // String type for approvalId
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

export const DeveloperAppSchema = new Schema<DeveloperAppDoc>({
  name: String,
  image: String,
  description: String,
  clientId: String,
  clientSecret: String,
  redirectUris: [String],
  createdBy: String,
  _docId: String
});

export const SIWBBRequestSchema = new Schema<SIWBBRequestDoc<JSPrimitiveNumberType>>({
  _docId: String,
  ownershipRequirements: Schema.Types.Mixed, // Mixed type for ownershipRequirements
  scopes: Schema.Types.Mixed, // Mixed type for scopes
  expiresAt: Schema.Types.Mixed, // Mixed type for expiresAt (number type)
  chain: String, // String type for chain
  address: String, // String type for address
  name: String, // String type for name
  description: String, // String type for description
  image: String, // String type for image
  cosmosAddress: String, // String type for cosmosAddress
  createdAt: Schema.Types.Mixed, // Mixed type for createdAt (number type)
  deletedAt: Schema.Types.Mixed, // Mixed type for deletedAt (number type)
  attestationsPresentations: [Schema.Types.Mixed], // Array of Mixed type for attestationsPresentations,
  clientId: String, // String type for clientId
  otherSignIns: Schema.Types.Mixed, // Mixed type for otherSignIns
  redirectUri: String // String type for redirectUri
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
  initiatedBy: String,
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
  from: String,
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
  apiKey: String,
  lastRequest: Number,
  label: String,
  intendedUse: String,
  cosmosAddress: String,
  createdAt: Number,
  expiry: Number,
  tier: String
});

export const ErrorSchema = new Schema({
  error: Schema.Types.Mixed,
  _docId: String
});

export const ClaimAttemptStatusSchema = new Schema({
  error: Schema.Types.Mixed,
  success: Boolean,
  _docId: String,
  code: String,
  claimInfo: Schema.Types.Mixed
});

export const ClaimDocHistorySchema = new Schema({
  _docId: String,
  claimId: String,
  updatedAt: Number,
  prevDoc: Schema.Types.Mixed
});

export const PluginDocHistorySchema = new Schema({
  _docId: String,
  pluginId: String,
  updatedAt: Number,
  prevDoc: Schema.Types.Mixed
});

export const OffChainUrlSchema = new Schema<OffChainUrlDoc>({
  collectionId: Number,
  _docId: String,
  createdBy: String
});

export const ReportSchema = new Schema({
  _docId: String,
  collectionId: Number,
  listId: String,
  mapId: String,
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

const DigitalOceanBalancesSchema = new Schema({
  _docId: String,
  balances: Schema.Types.Mixed
});

const OneTimeEmailModelSchema = new Schema({
  _docId: String,
  email: String,
  timestamp: Number
});

export const DigitalOceanBalancesModel = mongoose.model<DigitalOceanBalancesDoc<JSPrimitiveNumberType>>(
  'digital-ocean-balances',
  DigitalOceanBalancesSchema
);

//IMPORTANT: The names are somehow pluralized in the model creation process, so we should always make sure they match and are the plural version
export const AttestationProofSchemaModel = mongoose.model<AttestationProofDoc<JSPrimitiveNumberType>>('attestation-proofs', AttestationProofSchema);
export const OneTimeEmailModel = mongoose.model('one-time-emails', OneTimeEmailModelSchema);
export const AuthorizationCodeModel = mongoose.model<AuthorizationCodeDoc>('authorization-codes', AuthorizationCodeSchema);
export const AccessTokenModel = mongoose.model<AccessTokenDoc>('access-tokens', AccessTokenSchema);
export const ClaimAttemptStatusModel = mongoose.model('claim-attempt-statuses', ClaimAttemptStatusSchema);
export const ClaimDocHistoryModel = mongoose.model('claim-doc-histories', ClaimDocHistorySchema);
export const PluginDocHistoryModel = mongoose.model('plugin-doc-histories', PluginDocHistorySchema);
export const PluginModel = mongoose.model<PluginDoc<JSPrimitiveNumberType>>('plugins', PluginSchema);
export const DeveloperAppModel = mongoose.model<DeveloperAppDoc>('auth-apps', DeveloperAppSchema);
export const MapModel = mongoose.model<MapDoc<JSPrimitiveNumberType>>('maps', MapSchema);
export const OffChainAttestationsModel = mongoose.model<AttestationDoc<JSPrimitiveNumberType>>('attestations', OffChainAttestationsSchema);
export const BrowseModel = mongoose.model<BrowseDoc<JSPrimitiveNumberType>>('browse', BrowseSchema);
export const ApiKeyModel = mongoose.model<ApiKeyDoc>('api-keys', ApiKeySchema);
export const FetchModel = mongoose.model<FetchDoc<JSPrimitiveNumberType>>('fetches', FetchSchema);
export const QueueModel = mongoose.model<QueueDoc<JSPrimitiveNumberType>>('queues', QueueSchema);
export const RefreshModel = mongoose.model<RefreshDoc<JSPrimitiveNumberType>>('refreshes', RefreshSchema);
export const StatusModel = mongoose.model<StatusDoc<JSPrimitiveNumberType>>('status', StatusSchema);
export const AccountModel = mongoose.model<AccountDoc<JSPrimitiveNumberType>>('accounts', AccountSchema);
export const CollectionModel = mongoose.model<CollectionDoc<JSPrimitiveNumberType>>('collections', CollectionSchema);
export const BalanceModel = mongoose.model<BalanceDoc<JSPrimitiveNumberType>>('balances', BalanceSchema);
export const MerkleChallengeModel = mongoose.model<MerkleChallengeDoc<JSPrimitiveNumberType>>('merkle-challenges', ChallengeSchema);
export const ClaimBuilderModel = mongoose.model<ClaimBuilderDoc<JSPrimitiveNumberType>>('claims', ClaimBuilderSchema);
export const ProfileModel = mongoose.model<ProfileDoc<JSPrimitiveNumberType>>('profiles', ProfileSchema);
export const TransferActivityModel = mongoose.model<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activities', TransferActivitySchema);
export const ReviewModel = mongoose.model<ReviewDoc<JSPrimitiveNumberType>>('reviews', ReviewSchema);
export const IPFSTotalsModel = mongoose.model<IPFSTotalsDoc<JSPrimitiveNumberType>>('ipfs-totals', IPFSTotalsSchema);
export const AirdropModel = mongoose.model<AirdropDoc<JSPrimitiveNumberType>>('airdrops', AirdropSchema);
export const AddressListModel = mongoose.model<AddressListDoc<JSPrimitiveNumberType>>('address-lists', AddressListSchema);
export const ApprovalTrackerModel = mongoose.model<ApprovalTrackerDoc<JSPrimitiveNumberType>>('approvals-trackers', ApprovalTrackerSchema);
export const ClaimAlertModel = mongoose.model<ClaimAlertDoc<JSPrimitiveNumberType>>('claim-alerts', ClaimAlertSchema);
export const ComplianceModel = mongoose.model<ComplianceDoc<JSPrimitiveNumberType>>('compliances', ComplianceSchema);
export const SIWBBRequestModel = mongoose.model<SIWBBRequestDoc<JSPrimitiveNumberType>>('auth-codes', SIWBBRequestSchema);
export const FollowDetailsModel = mongoose.model<FollowDetailsDoc<JSPrimitiveNumberType>>('follows', FollowDetailsSchema);
export const ListActivityModel = mongoose.model<ListActivityDoc<JSPrimitiveNumberType>>('list-activities', ListActivitySchema);
export const PageVisitsModel = mongoose.model<PageVisitsDoc<JSPrimitiveNumberType>>('page-visits', PageVisitsSchema);
export const ErrorModel = mongoose.model<ErrorDoc>('errors', ErrorSchema);
export const UsernameModel = mongoose.model<UsernameDoc>('usernames', UsernameSchema);
export const EthTxCountModel = mongoose.model<EthTxCountDoc>('eth-tx-counts', EthTxCountSchema);
export const OffChainUrlModel = mongoose.model<OffChainUrlDoc>('off-chain-urls', OffChainUrlSchema);
export const ReportModel = mongoose.model<ReportDoc>('reports', ReportSchema);

export type TypedInterfaceFromModel<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends NumberType = bigint> = T extends AuthorizationCodeDoc
  ? iAuthorizationCodeDoc
  : T extends AccessTokenDoc
    ? iAccessTokenDoc
    : T extends DigitalOceanBalancesDoc<JSPrimitiveNumberType>
      ? iDigitalOceanBalancesDoc<U>
      : T extends AttestationProofDoc<JSPrimitiveNumberType>
        ? iAttestationProofDoc<U>
        : T extends DeveloperAppDoc
          ? iDeveloperAppDoc
          : T extends PluginDoc<JSPrimitiveNumberType>
            ? iPluginDoc<U>
            : T extends StatusDoc<JSPrimitiveNumberType>
              ? iStatusDoc<U>
              : T extends AccountDoc<JSPrimitiveNumberType>
                ? iAccountDoc<U>
                : T extends CollectionDoc<JSPrimitiveNumberType>
                  ? iCollectionDoc<U>
                  : T extends SIWBBRequestDoc<JSPrimitiveNumberType>
                    ? iSIWBBRequestDoc<U>
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
                                                    : T extends ListActivityDoc<JSPrimitiveNumberType>
                                                      ? iListActivityDoc<U>
                                                      : T extends PageVisitsDoc<JSPrimitiveNumberType>
                                                        ? iPageVisitsDoc<U>
                                                        : T extends AttestationDoc<JSPrimitiveNumberType>
                                                          ? iAttestationDoc<U>
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
                                                                        : T extends KeysDoc
                                                                          ? KeysDoc
                                                                          : T extends MapDoc<JSPrimitiveNumberType>
                                                                            ? iMapDoc<U>
                                                                            : never;

export type TypedDocFromModel<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends NumberType = bigint> = T extends AuthorizationCodeDoc
  ? AuthorizationCodeDoc
  : T extends AccessTokenDoc
    ? AccessTokenDoc
    : T extends AttestationProofDoc<JSPrimitiveNumberType>
      ? AttestationProofDoc<U>
      : T extends DigitalOceanBalancesDoc<JSPrimitiveNumberType>
        ? DigitalOceanBalancesDoc<U>
        : T extends DeveloperAppDoc
          ? DeveloperAppDoc
          : T extends PluginDoc<JSPrimitiveNumberType>
            ? PluginDoc<U>
            : T extends StatusDoc<JSPrimitiveNumberType>
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
                            : T extends SIWBBRequestDoc<JSPrimitiveNumberType>
                              ? SIWBBRequestDoc<U>
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
                                                    : T extends AttestationDoc<JSPrimitiveNumberType>
                                                      ? AttestationDoc<U>
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
                                                                        : T extends KeysDoc
                                                                          ? KeysDoc
                                                                          : T extends MapDoc<JSPrimitiveNumberType>
                                                                            ? MapDoc<U>
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
  | SIWBBRequestDoc<T>
  | FollowDetailsDoc<T>
  | BrowseDoc<T>
  | ListActivityDoc<T>
  | PageVisitsDoc<T>
  | UsernameDoc
  | KeysDoc
  | AttestationDoc<T>
  | MapDoc<T>
  | DigitalOceanBalancesDoc<T>
  | DeveloperAppDoc
  | PluginDoc<T>
  | AttestationProofDoc<T>;

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
  | iSIWBBRequestDoc<T>
  | iFollowDetailsDoc<T>
  | BrowseDoc<T>
  | iListActivityDoc<T>
  | iPageVisitsDoc<T>
  | UsernameDoc
  | KeysDoc
  | iAttestationDoc<T>
  | iMapDoc<T>
  | iDigitalOceanBalancesDoc<T>
  | iDeveloperAppDoc
  | iPluginDoc<T>
  | iAttestationProofDoc<T>;
