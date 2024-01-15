import { config } from "dotenv";
import { AccountModel, AddressListModel, AirdropModel, AnnouncementModel, ApiKeyModel, ApiKeySchema, ApprovalTrackerModel, BalanceModel, BlockinAuthSignatureModel, BrowseModel, BrowseSchema, ClaimAlertModel, CollectionModel, ComplianceModel, ErrorModel, ErrorSchema, EthTxCountModel, EthTxCountSchema, FetchModel, FollowDetailsModel, IPFSTotalsModel, ListActivityModel, MerkleChallengeModel, MongoDB, OffChainUrlModel, OffChainUrlSchema, PageVisitsModel, PageVisitsSchema, PasswordModel, ProfileModel, ProtocolModel, QueueModel, RefreshModel, ReportModel, ReportSchema, ReviewModel, StatusModel, TransferActivityModel, UserProtocolCollectionsModel, UsernameModel, UsernameSchema, insertToDB } from "./db/db";
import { FetchSchema, QueueSchema, RefreshSchema, StatusSchema, AccountSchema, CollectionSchema, BalanceSchema, ChallengeSchema, PasswordSchema, ProfileSchema, TransferActivitySchema, AnnouncementSchema, ReviewSchema, IPFSTotalsSchema, AirdropSchema, AddressListSchema, ApprovalTrackerSchema, ClaimAlertSchema, ComplianceSchema, BlockinAuthSignatureSchema, FollowDetailsSchema, ProtocolSchema, UserProtocolCollectionsSchema, ListActivitySchema } from "bitbadgesjs-utils";

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
  await MongoDB.dropCollection(AddressListModel.collection.name);
  await MongoDB.dropCollection(ApprovalTrackerModel.collection.name);
  await MongoDB.dropCollection(ClaimAlertModel.collection.name);
  await MongoDB.dropCollection(EthTxCountModel.collection.name);
  await MongoDB.dropCollection(OffChainUrlModel.collection.name);
  await MongoDB.dropCollection(ReportModel.collection.name);
  await MongoDB.dropCollection(ComplianceModel.collection.name);
  await MongoDB.dropCollection(BlockinAuthSignatureModel.collection.name);
  await MongoDB.dropCollection(FollowDetailsModel.collection.name);
  await MongoDB.dropCollection(ProtocolModel.collection.name);
  await MongoDB.dropCollection(UserProtocolCollectionsModel.collection.name);
  await MongoDB.dropCollection(ListActivityModel.collection.name);
  await MongoDB.dropCollection(PageVisitsModel.collection.name);
}
//new ObjectId
export async function initStatus() {

  if (process.env.BITBADGES_API_KEY === undefined) throw new Error("BITBADGES_API_KEY env var not set");
  await insertToDB(ApiKeyModel, {
    "_docId": process.env.BITBADGES_API_KEY,
  })
  await insertToDB(StatusModel, {
    "_docId": "status",
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
    _docId: "compliance",
    badges: {
      nsfw: [],
      reported: [],
    },
    addressLists: {
      nsfw: [],
      reported: [],
    },
    accounts: {
      nsfw: [],
      reported: [],
    },
  })

  await insertToDB(BrowseModel, {
    _docId: "browse",
    collections: {
      'featured': [1, 2, 16],
      'earnable': [],
    },
    profiles: {
      'featured': ["cosmos1xv9tklw7d82sezh9haa573wufgy59vmwe6xxe5"],
    },
    addressLists: {},
    badges: {
      'featured': [

        {
          collectionId: 1,
          badgeIds: [{ start: 1n, end: 15n }]
        }, {
          collectionId: 2,
          badgeIds: [{ start: 1n, end: 1n }]
        }, {
          collectionId: 16,
          badgeIds: [{ start: 1n, end: 10n }]
        }],
      'earnable': [],
    },
  })

}
export async function createIndexesAndViews() {
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
  ChallengeSchema.index({ _docId: 1 }, { unique: true });
  PasswordSchema.index({ _docId: 1 }, { unique: true });
  ProfileSchema.index({ _docId: 1 }, { unique: true });
  TransferActivitySchema.index({ _docId: 1 }, { unique: true });
  TransferActivitySchema.index({ timestamp: 1 });
  AnnouncementSchema.index({ _docId: 1 }, { unique: true });
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
  ProtocolSchema.index({ _docId: 1 }, { unique: true });
  UserProtocolCollectionsSchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ timestamp: 1 });
  PageVisitsSchema.index({ _docId: 1 }, { unique: true });

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
  await PasswordModel.createIndexes();
  await ProfileModel.createIndexes();
  await TransferActivityModel.createIndexes();
  await AnnouncementModel.createIndexes();
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
  await ProtocolModel.createIndexes();
  await UserProtocolCollectionsModel.createIndexes();
}

