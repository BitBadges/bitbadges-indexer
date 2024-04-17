import { config } from 'dotenv';
import { MongoDB, insertToDB } from '../db/db';
import {
  AccountModel,
  AccountSchema,
  AddressListModel,
  AddressListSchema,
  AirdropModel,
  AirdropSchema,
  ApiKeyModel,
  ApiKeySchema,
  ApprovalTrackerModel,
  ApprovalTrackerSchema,
  BalanceModel,
  BalanceSchema,
  BlockinAuthSignatureModel,
  BlockinAuthSignatureSchema,
  BrowseModel,
  BrowseSchema,
  ChallengeSchema,
  ClaimAlertModel,
  ClaimAlertSchema,
  ClaimBuilderModel,
  ClaimBuilderSchema,
  CollectionModel,
  CollectionSchema,
  ComplianceModel,
  ComplianceSchema,
  ErrorModel,
  ErrorSchema,
  EthTxCountModel,
  EthTxCountSchema,
  ExternalCallKeysModel,
  ExternalCallKeysSchema,
  FetchModel,
  FetchSchema,
  FollowDetailsModel,
  FollowDetailsSchema,
  IPFSTotalsModel,
  IPFSTotalsSchema,
  ListActivityModel,
  ListActivitySchema,
  MapModel,
  MapSchema,
  MerkleChallengeModel,
  OffChainSecretsModel,
  OffChainSecretsSchema,
  OffChainUrlModel,
  OffChainUrlSchema,
  PageVisitsModel,
  PageVisitsSchema,
  ProfileModel,
  ProfileSchema,
  QueueModel,
  QueueSchema,
  RefreshModel,
  RefreshSchema,
  ReportModel,
  ReportSchema,
  ReviewModel,
  ReviewSchema,
  StatusModel,
  StatusSchema,
  TransferActivityModel,
  TransferActivitySchema,
  UsernameModel,
  UsernameSchema
} from '../db/schemas';

config();

export async function deleteDatabases(): Promise<void> {
  await MongoDB.dropCollection(BrowseModel.collection.name);
  await MongoDB.dropCollection(MapModel.collection.name);
  await MongoDB.dropCollection(ExternalCallKeysModel.collection.name);
  await MongoDB.dropCollection(UsernameModel.collection.name);
  await MongoDB.dropCollection(ApiKeyModel.collection.name);
  await MongoDB.dropCollection(FetchModel.collection.name);
  await MongoDB.dropCollection(QueueModel.collection.name);
  await MongoDB.dropCollection(RefreshModel.collection.name);
  await MongoDB.dropCollection(StatusModel.collection.name);
  await MongoDB.dropCollection(AccountModel.collection.name);
  await MongoDB.dropCollection(CollectionModel.collection.name);
  await MongoDB.dropCollection(BalanceModel.collection.name);
  await MongoDB.dropCollection(MerkleChallengeModel.collection.name);
  await MongoDB.dropCollection(ClaimBuilderModel.collection.name);
  await MongoDB.dropCollection(ProfileModel.collection.name);
  await MongoDB.dropCollection(TransferActivityModel.collection.name);
  await MongoDB.dropCollection(ReviewModel.collection.name);
  await MongoDB.dropCollection(ErrorModel.collection.name);
  await MongoDB.dropCollection(IPFSTotalsModel.collection.name);
  await MongoDB.dropCollection(AirdropModel.collection.name);
  await MongoDB.dropCollection(AddressListModel.collection.name);
  await MongoDB.dropCollection(ApprovalTrackerModel.collection.name);
  await MongoDB.dropCollection(ClaimAlertModel.collection.name);
  await MongoDB.dropCollection(EthTxCountModel.collection.name);
  await MongoDB.dropCollection(OffChainUrlModel.collection.name);
  await MongoDB.dropCollection(ReportModel.collection.name);
  await MongoDB.dropCollection(ComplianceModel.collection.name);
  await MongoDB.dropCollection(BlockinAuthSignatureModel.collection.name);
  await MongoDB.dropCollection(FollowDetailsModel.collection.name);
  await MongoDB.dropCollection(ListActivityModel.collection.name);
  await MongoDB.dropCollection(PageVisitsModel.collection.name);
  await MongoDB.dropCollection(OffChainSecretsModel.collection.name);
}

// new ObjectId
export async function initStatus(): Promise<void> {
  if (process.env.BITBADGES_API_KEY === undefined) throw new Error('BITBADGES_API_KEY env var not set');
  await insertToDB(ApiKeyModel, {
    _docId: process.env.BITBADGES_API_KEY,
    numRequests: 0,
    lastRequest: 0
  });

  await insertToDB(StatusModel, {
    _docId: 'status',
    block: {
      height: '1',
      txIndex: '0',
      timestamp: 0
    },
    nextCollectionId: '1',
    gasPrice: 1,
    lastXGasAmounts: ['1'],
    lastXGasLimits: ['1']
  });

  await insertToDB(ComplianceModel, {
    _docId: 'compliance',
    badges: {
      nsfw: [],
      reported: []
    },
    addressLists: {
      nsfw: [],
      reported: []
    },
    accounts: {
      nsfw: [],
      reported: []
    }
  });

  await insertToDB(BrowseModel, {
    _docId: 'browse',
    collections: {
      featured: [1, 2, 16],
      earnable: []
    },
    profiles: {
      featured: ['cosmos1xv9tklw7d82sezh9haa573wufgy59vmwe6xxe5']
    },
    addressLists: {},
    badges: {
      featured: [
        {
          collectionId: 1,
          badgeIds: [{ start: 1n, end: 15n }]
        },
        {
          collectionId: 2,
          badgeIds: [{ start: 1n, end: 1n }]
        },
        {
          collectionId: 16,
          badgeIds: [{ start: 1n, end: 10n }]
        }
      ],
      earnable: []
    }
  });
}
export async function createIndexesAndViews(): Promise<void> {
  MapSchema.index({ _docId: 1 }, { unique: true });
  BrowseSchema.index({ _docId: 1 }, { unique: true });
  UsernameSchema.index({ _docId: 1 }, { unique: true });
  ApiKeySchema.index({ _docId: 1 }, { unique: true });
  FetchSchema.index({ _docId: 1 }, { unique: true });
  QueueSchema.index({ _docId: 1 }, { unique: true });
  RefreshSchema.index({ _docId: 1 }, { unique: true });
  StatusSchema.index({ _docId: 1 }, { unique: true });
  AccountSchema.index({ _docId: 1 }, { unique: true });
  CollectionSchema.index({ _docId: 1 }, { unique: true });
  CollectionSchema.index({ collectionId: 1 }, { unique: true });
  BalanceSchema.index({ _docId: 1 }, { unique: true });
  BalanceSchema.index({ collectionId: 1 });
  BalanceSchema.index({ cosmosAddress: 1 });

  ChallengeSchema.index({ _docId: 1 }, { unique: true });
  ClaimBuilderSchema.index({ _docId: 1 }, { unique: true });
  ProfileSchema.index({ _docId: 1 }, { unique: true });
  TransferActivitySchema.index({ _docId: 1 }, { unique: true });
  TransferActivitySchema.index({ timestamp: 1 });
  ReviewSchema.index({ _docId: 1 }, { unique: true });
  ErrorSchema.index({ _docId: 1 }, { unique: true });
  IPFSTotalsSchema.index({ _docId: 1 }, { unique: true });
  AirdropSchema.index({ _docId: 1 }, { unique: true });
  AddressListSchema.index({ _docId: 1 }, { unique: true });
  ApprovalTrackerSchema.index({ _docId: 1 }, { unique: true });
  ClaimAlertSchema.index({ _docId: 1 }, { unique: true });
  ClaimAlertSchema.index({ timestamp: 1 });
  EthTxCountSchema.index({ _docId: 1 }, { unique: true });
  OffChainUrlSchema.index({ _docId: 1 }, { unique: true });
  ReportSchema.index({ _docId: 1 }, { unique: true });
  ComplianceSchema.index({ _docId: 1 }, { unique: true });
  BlockinAuthSignatureSchema.index({ _docId: 1 }, { unique: true });
  FollowDetailsSchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ timestamp: 1 });
  PageVisitsSchema.index({ _docId: 1 }, { unique: true });
  ExternalCallKeysSchema.index({ _docId: 1 }, { unique: true });
  OffChainSecretsSchema.index({ _docId: 1 }, { unique: true });

  await MapModel.createIndexes();
  await OffChainSecretsModel.createIndexes();
  await ExternalCallKeysModel.createIndexes();
  await PageVisitsModel.createIndexes();
  await ListActivityModel.createIndexes();
  await BrowseModel.createIndexes();
  await UsernameModel.createIndexes();
  await ApiKeyModel.createIndexes();
  await FetchModel.createIndexes();
  await QueueModel.createIndexes();
  await RefreshModel.createIndexes();
  await StatusModel.createIndexes();
  await AccountModel.createIndexes();
  await CollectionModel.createIndexes();
  await BalanceModel.createIndexes();
  await MerkleChallengeModel.createIndexes();
  await ClaimBuilderModel.createIndexes();
  await ProfileModel.createIndexes();
  await TransferActivityModel.createIndexes();
  await ReviewModel.createIndexes();
  await ErrorModel.createIndexes();
  await IPFSTotalsModel.createIndexes();
  await AirdropModel.createIndexes();
  await AddressListModel.createIndexes();
  await ApprovalTrackerModel.createIndexes();
  await ClaimAlertModel.createIndexes();
  await EthTxCountModel.createIndexes();
  await OffChainUrlModel.createIndexes();
  await ReportModel.createIndexes();
  await ComplianceModel.createIndexes();
  await BlockinAuthSignatureModel.createIndexes();
  await FollowDetailsModel.createIndexes();
}
