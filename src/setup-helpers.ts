import { config } from "dotenv";
import { AccountModel, AddressMappingModel, AirdropModel, AnnouncementModel, ApiKeyModel, ApiKeySchema, ApprovalsTrackerModel, BalanceModel, BlockinAuthSignatureModel, ClaimAlertModel, CollectionModel, ComplianceModel, ErrorModel, ErrorSchema, EthTxCountModel, EthTxCountSchema, FetchModel, FollowDetailsModel, IPFSTotalsModel, MerkleChallengeModel, MongoDB, OffChainUrlModel, OffChainUrlSchema, PasswordModel, ProfileModel, QueueModel, RefreshModel, ReportModel, ReportSchema, ReviewModel, StatusModel, TransferActivityModel, UsernameModel, UsernameSchema, insertToDB } from "./db/db";
import { FetchSchema, QueueSchema, RefreshSchema, StatusSchema, AccountSchema, CollectionSchema, BalanceSchema, ChallengeSchema, PasswordSchema, ProfileSchema, TransferActivitySchema, AnnouncementSchema, ReviewSchema, IPFSTotalsSchema, AirdropSchema, AddressMappingSchema, ApprovalsTrackerSchema, ClaimAlertSchema, ComplianceSchema, BlockinAuthSignatureSchema, FollowDetailsSchema } from "bitbadgesjs-utils";

config()

export async function deleteDatabases() {
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
  await MongoDB.dropCollection(PasswordModel.collection.name);
  await MongoDB.dropCollection(ProfileModel.collection.name);
  await MongoDB.dropCollection(TransferActivityModel.collection.name);
  await MongoDB.dropCollection(AnnouncementModel.collection.name);
  await MongoDB.dropCollection(ReviewModel.collection.name);
  await MongoDB.dropCollection(ErrorModel.collection.name);
  await MongoDB.dropCollection(IPFSTotalsModel.collection.name);
  await MongoDB.dropCollection(AirdropModel.collection.name);
  await MongoDB.dropCollection(AddressMappingModel.collection.name);
  await MongoDB.dropCollection(ApprovalsTrackerModel.collection.name);
  await MongoDB.dropCollection(ClaimAlertModel.collection.name);
  await MongoDB.dropCollection(EthTxCountModel.collection.name);
  await MongoDB.dropCollection(OffChainUrlModel.collection.name);
  await MongoDB.dropCollection(ReportModel.collection.name);
  await MongoDB.dropCollection(ComplianceModel.collection.name);
  await MongoDB.dropCollection(BlockinAuthSignatureModel.collection.name);
  await MongoDB.dropCollection(FollowDetailsModel.collection.name);
}
//new ObjectId
export async function initStatus() {

  if (process.env.BITBADGES_API_KEY === undefined) throw new Error("BITBADGES_API_KEY env var not set");
  await insertToDB(ApiKeyModel, {
    "_legacyId": process.env.BITBADGES_API_KEY,
  })
  await insertToDB(StatusModel, {
    "_legacyId": "status",
    "block": {
      "height": "1",
      "txIndex": "0",
      "timestamp": 0
    },
    "nextCollectionId": "1",
    "gasPrice": 1,
    "lastXGasAmounts": [
      "1"
    ],
    "lastXGasLimits": [
      "1"
    ],
  })

  await insertToDB(ComplianceModel, {
    _legacyId: "compliance",
    badges: {
      nsfw: [],
      reported: [],
    },
    addressMappings: {
      nsfw: [],
      reported: [],
    },
    accounts: {
      nsfw: [],
      reported: [],
    },
  })
}
export async function createIndexesAndViews() {
  UsernameSchema.index({ _legacyId: 1 }, { unique: true });
  ApiKeySchema.index({ _legacyId: 1 }, { unique: true });
  FetchSchema.index({ _legacyId: 1 }, { unique: true });
  QueueSchema.index({ _legacyId: 1 }, { unique: true });
  RefreshSchema.index({ _legacyId: 1 }, { unique: true });
  StatusSchema.index({ _legacyId: 1 }, { unique: true });
  AccountSchema.index({ _legacyId: 1 }, { unique: true });
  CollectionSchema.index({ _legacyId: 1 }, { unique: true });
  BalanceSchema.index({ _legacyId: 1 }, { unique: true });
  ChallengeSchema.index({ _legacyId: 1 }, { unique: true });
  PasswordSchema.index({ _legacyId: 1 }, { unique: true });
  ProfileSchema.index({ _legacyId: 1 }, { unique: true });
  TransferActivitySchema.index({ _legacyId: 1 }, { unique: true });
  AnnouncementSchema.index({ _legacyId: 1 }, { unique: true });
  ReviewSchema.index({ _legacyId: 1 }, { unique: true });
  ErrorSchema.index({ _legacyId: 1 }, { unique: true });
  IPFSTotalsSchema.index({ _legacyId: 1 }, { unique: true });
  AirdropSchema.index({ _legacyId: 1 }, { unique: true });
  AddressMappingSchema.index({ _legacyId: 1 }, { unique: true });
  ApprovalsTrackerSchema.index({ _legacyId: 1 }, { unique: true });
  ClaimAlertSchema.index({ _legacyId: 1 }, { unique: true });
  EthTxCountSchema.index({ _legacyId: 1 }, { unique: true });
  OffChainUrlSchema.index({ _legacyId: 1 }, { unique: true });
  ReportSchema.index({ _legacyId: 1 }, { unique: true });
  ComplianceSchema.index({ _legacyId: 1 }, { unique: true });
  BlockinAuthSignatureSchema.index({ _legacyId: 1 }, { unique: true });
  FollowDetailsSchema.index({ _legacyId: 1 }, { unique: true });

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
  await PasswordModel.createIndexes();
  await ProfileModel.createIndexes();
  await TransferActivityModel.createIndexes();
  await AnnouncementModel.createIndexes();
  await ReviewModel.createIndexes();
  await ErrorModel.createIndexes();
  await IPFSTotalsModel.createIndexes();
  await AirdropModel.createIndexes();
  await AddressMappingModel.createIndexes();
  await ApprovalsTrackerModel.createIndexes();
  await ClaimAlertModel.createIndexes();
  await EthTxCountModel.createIndexes();
  await OffChainUrlModel.createIndexes();
  await ReportModel.createIndexes();
  await ComplianceModel.createIndexes();
  await BlockinAuthSignatureModel.createIndexes();
  await FollowDetailsModel.createIndexes();
}

