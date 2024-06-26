import { PluginPresetType } from 'bitbadgesjs-sdk';
import { config } from 'dotenv';
import { MongoDB, insertToDB } from '../db/db';
import {
  AccessTokenModel,
  AccessTokenSchema,
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
  AttestationProofSchema,
  AttestationProofSchemaModel,
  AuthorizationCodeModel,
  AuthorizationCodeSchema,
  BalanceModel,
  BalanceSchema,
  BrowseModel,
  BrowseSchema,
  ChallengeSchema,
  ClaimAlertModel,
  ClaimAlertSchema,
  ClaimAttemptStatusModel,
  ClaimBuilderModel,
  ClaimBuilderSchema,
  ClaimDocHistoryModel,
  CollectionModel,
  CollectionSchema,
  ComplianceModel,
  ComplianceSchema,
  DeveloperAppModel,
  DeveloperAppSchema,
  DigitalOceanBalancesModel,
  ErrorModel,
  ErrorSchema,
  EthTxCountModel,
  EthTxCountSchema,
  FaucetModel,
  FaucetSchema,
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
  OffChainAttestationsModel,
  OffChainAttestationsSchema,
  OffChainUrlModel,
  OffChainUrlSchema,
  PageVisitsModel,
  PageVisitsSchema,
  PluginDocHistoryModel,
  PluginModel,
  PluginSchema,
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
  SIWBBRequestModel,
  SIWBBRequestSchema,
  StatusModel,
  StatusSchema,
  TransferActivityModel,
  TransferActivitySchema,
  UsernameModel,
  UsernameSchema
} from '../db/schemas';

config();

export async function deleteDatabases(): Promise<void> {
  await MongoDB.dropCollection(FaucetModel.collection.name);
  await MongoDB.dropCollection(AttestationProofSchemaModel.collection.name);
  await MongoDB.dropCollection(ClaimAttemptStatusModel.collection.name);
  await MongoDB.dropCollection(PluginDocHistoryModel.collection.name);
  await MongoDB.dropCollection(ClaimDocHistoryModel.collection.name);
  await MongoDB.dropCollection(ApiKeyModel.collection.name);
  await MongoDB.dropCollection(DigitalOceanBalancesModel.collection.name);
  await MongoDB.dropCollection(AuthorizationCodeModel.collection.name);
  await MongoDB.dropCollection(AccessTokenModel.collection.name);
  await MongoDB.dropCollection(PluginModel.collection.name);
  await MongoDB.dropCollection(DeveloperAppModel.collection.name);
  await MongoDB.dropCollection(BrowseModel.collection.name);
  await MongoDB.dropCollection(MapModel.collection.name);
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
  await MongoDB.dropCollection(SIWBBRequestModel.collection.name);
  await MongoDB.dropCollection(FollowDetailsModel.collection.name);
  await MongoDB.dropCollection(ListActivityModel.collection.name);
  await MongoDB.dropCollection(PageVisitsModel.collection.name);
  await MongoDB.dropCollection(OffChainAttestationsModel.collection.name);
}

export async function initStatus(): Promise<void> {
  if (process.env.BITBADGES_API_KEY === undefined) throw new Error('BITBADGES_API_KEY env var not set');
  await insertToDB(ApiKeyModel, {
    _docId: 'default-setup',
    apiKey: process.env.BITBADGES_API_KEY,
    cosmosAddress: '',
    numRequests: 0,
    lastRequest: 0,
    label: 'default',
    intendedUse: 'default',
    createdAt: 0,
    expiry: Number.MAX_SAFE_INTEGER,
    tier: 'unlimited'
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
    lastXGasAmounts: ['0'],
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

  await insertToDB(PluginModel, {
    _docId: 'min-badge',
    approvedUsers: [],
    createdBy: '',
    pluginId: 'min-badge',
    requiresSessions: false,
    requiresUserInputs: false,
    duplicatesAllowed: false,
    reuseForNonIndexed: true,
    reuseForLists: true,
    metadata: {
      name: 'Min $BADGE',
      description: 'Users must have a minimum balance of $BADGE.',
      image: 'https://avatars.githubusercontent.com/u/86890740',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [],
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    publicParamsSchema: [{ key: 'minBalance', label: 'Min $BADGE Balance', type: 'number' }],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/min-badge',
      passDiscord: false,
      passEmail: false,
      passTwitter: false,
      passAddress: true,
      passGoogle: false,
      passGithub: false,
      passTwitch: false,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: 'not needed',
    stateFunctionPreset: PluginPresetType.Stateless
  });

  await insertToDB(PluginModel, {
    _docId: 'must-own-badges',
    approvedUsers: [],
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    createdBy: '',
    pluginId: 'must-own-badges',
    requiresSessions: false,
    requiresUserInputs: false,
    duplicatesAllowed: true,
    reuseForNonIndexed: true,
    reuseForLists: true,
    metadata: {
      name: 'Ownership Requirements',
      description: 'Which badges / lists must the user own / be on to claim this badge?',
      image: 'https://avatars.githubusercontent.com/u/86890740',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [],
    publicParamsSchema: [{ key: 'ownershipRequirements', label: 'Ownership Requirements', type: 'ownershipRequirements' }],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/must-own-badges',
      passDiscord: false,
      passEmail: false,
      passTwitter: false,
      passAddress: true,
      passGoogle: false,
      passTwitch: false,
      passGithub: false,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: ' ',
    stateFunctionPreset: PluginPresetType.Stateless
  });

  await insertToDB(PluginModel, {
    _docId: 'github-contributions',
    approvedUsers: [],
    createdBy: '',
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    pluginId: 'github-contributions',
    requiresSessions: true,
    requiresUserInputs: false,
    duplicatesAllowed: true,
    reuseForNonIndexed: false,
    reuseForLists: true,
    metadata: {
      name: 'Github Contributions',
      description: "Check a user's Github contributions to a specific repository.",
      image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/GitHub_Invertocat_Logo.svg/640px-GitHub_Invertocat_Logo.svg.png',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [],
    publicParamsSchema: [{ key: 'repository', label: 'Repository', type: 'string', helper: 'Ex: bitbadges/bitbadges-frontend' }],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/github-contributions',
      passDiscord: false,
      passEmail: false,
      passTwitter: false,
      passAddress: false,
      passTwitch: false,
      passGoogle: false,
      passGithub: true,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: ' ',
    stateFunctionPreset: PluginPresetType.Stateless
  });

  await insertToDB(PluginModel, {
    _docId: 'discord-server',
    approvedUsers: [],
    createdBy: '',
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    pluginId: 'discord-server',
    requiresSessions: true,
    requiresUserInputs: false,
    duplicatesAllowed: true,
    reuseForNonIndexed: false,
    reuseForLists: true,
    metadata: {
      name: 'Discord Server',
      description: 'Check if a user is in a Discord server.',
      image: 'https://static.vecteezy.com/system/resources/previews/006/892/625/original/discord-logo-icon-editorial-free-vector.jpg',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [
      {
        key: 'serverId',
        label: 'Server ID',
        type: 'string',
        helper:
          'ID of the Discord server. This is a large number (e.g. 846474505189588992), not the server name. See https://docs.bitbadges.io/overview/claim-builder/discord for more information.'
      }
    ],
    publicParamsSchema: [{ key: 'serverName', label: 'Server Name', type: 'string', helper: 'Display name for the server.' }],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/discord-server',
      passDiscord: true,
      passEmail: false,
      passTwitter: false,
      passAddress: false,
      passGoogle: false,
      passGithub: false,
      passTwitch: false,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: ' ',
    stateFunctionPreset: PluginPresetType.Stateless
  });

  await insertToDB(PluginModel, {
    _docId: 'twitch-follow',
    approvedUsers: [],
    createdBy: '',
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    pluginId: 'twitch-follow',
    requiresSessions: true,
    requiresUserInputs: false,
    duplicatesAllowed: true,
    reuseForNonIndexed: false,
    reuseForLists: true,
    metadata: {
      name: 'Twitch Follow',
      description: 'Check if a user is following a Twitch channel.',
      image: 'https://pngimg.com/d/twitch_PNG28.png',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [],
    publicParamsSchema: [
      { key: 'channelName', label: 'Channel Name', type: 'string', helper: 'Channel login name. For example, twitch.tv/CHANNEL_NAME_HERE' }
    ],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/twitch-follow',
      passDiscord: false,
      passEmail: false,
      passTwitter: false,
      passAddress: false,
      passGoogle: false,
      passGithub: false,
      passTwitch: true,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: ' ',
    stateFunctionPreset: PluginPresetType.Stateless
  });

  await insertToDB(PluginModel, {
    _docId: 'twitch-subscription',
    approvedUsers: [],
    createdBy: '',
    lastUpdated: Date.now(),
    createdAt: Date.now(),
    toPublish: false,
    pluginId: 'twitch-subscription',
    requiresSessions: true,
    requiresUserInputs: false,
    duplicatesAllowed: true,
    reuseForNonIndexed: false,
    reuseForLists: true,
    metadata: {
      name: 'Twitch Subscriptions',
      description: 'Check if a user is subscribed to a Twitch channel.',
      image: 'https://pngimg.com/d/twitch_PNG28.png',
      createdBy: 'BitBadges',
      documentation: 'https://docs.bitbadges.io',
      sourceCode: 'https://github.com/bitbadges/bitbadges-indexer'
    },
    userInputsSchema: [],
    privateParamsSchema: [],
    publicParamsSchema: [
      { key: 'channelName', label: 'Channel Name', type: 'string', helper: 'Channel login name. For example, twitch.tv/CHANNEL_NAME_HERE' }
    ],
    verificationCall: {
      method: 'POST',
      uri: 'https://api.bitbadges.io/api/v0/integrations/query/twitch-subscription',
      passDiscord: false,
      passEmail: false,
      passTwitter: false,
      passAddress: false,
      passGoogle: false,
      passGithub: false,
      passTwitch: true,
      hardcodedInputs: []
    },
    reviewCompleted: true,
    pluginSecret: ' ',
    stateFunctionPreset: PluginPresetType.Stateless
  });
}

export async function createIndexesAndViews(): Promise<void> {
  FaucetSchema.index({ _docId: 1 }, { unique: true });
  DeveloperAppSchema.index({ _docId: 1 }, { unique: true });
  PluginSchema.index({ _docId: 1 }, { unique: true });
  AccessTokenSchema.index({ _docId: 1 }, { unique: true });
  AuthorizationCodeSchema.index({ _docId: 1 }, { unique: true });

  AttestationProofSchema.index({ _docId: 1 }, { unique: true });
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
  SIWBBRequestSchema.index({ _docId: 1 }, { unique: true });
  FollowDetailsSchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ _docId: 1 }, { unique: true });
  ListActivitySchema.index({ timestamp: 1 });
  PageVisitsSchema.index({ _docId: 1 }, { unique: true });
  OffChainAttestationsSchema.index({ _docId: 1 }, { unique: true });

  await FaucetModel.createIndexes();
  await MapModel.createIndexes();
  await OffChainAttestationsModel.createIndexes();
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
  await SIWBBRequestModel.createIndexes();
  await FollowDetailsModel.createIndexes();
}
