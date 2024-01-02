import { Balance, JSPrimitiveNumberType, NumberType, NumberifyIfPossible, UintRange, convertBalance } from 'bitbadgesjs-proto';
import { config } from "dotenv";
import mongoose from 'mongoose';

import { ListActivitySchema, AccountDoc, AccountSchema, ActivityDoc, AddressMappingDoc, AddressMappingSchema, AirdropDoc, AirdropSchema, AnnouncementDoc, AnnouncementSchema, ApprovalsTrackerDoc, ApprovalsTrackerSchema, BalanceDoc, BalanceSchema, BlockinAuthSignatureDoc, BlockinAuthSignatureSchema, ChallengeSchema, ClaimAlertDoc, ClaimAlertSchema, CollectionDoc, CollectionSchema, ComplianceDoc, ComplianceSchema, ErrorDoc, FetchDoc, FetchSchema, FollowDetailsDoc, FollowDetailsSchema, IPFSTotalsDoc, IPFSTotalsSchema, ListActivityDoc, MerkleChallengeDoc, PasswordDoc, PasswordSchema, ProfileDoc, ProfileSchema, ProtocolDoc, ProtocolSchema, QueueDoc, QueueSchema, RefreshDoc, RefreshSchema, ReviewDoc, ReviewSchema, StatusDoc, StatusSchema, TransferActivityDoc, TransferActivitySchema, UserProtocolCollectionsDoc, UserProtocolCollectionsSchema, convertAccountDoc, convertAddressMappingDoc, convertAirdropDoc, convertAnnouncementDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertBlockinAuthSignatureDoc, convertClaimAlertDoc, convertCollectionDoc, convertComplianceDoc, convertFetchDoc, convertFollowDetailsDoc, convertIPFSTotalsDoc, convertMerkleChallengeDoc, convertPasswordDoc, convertProfileDoc, convertProtocolDoc, convertQueueDoc, convertRefreshDoc, convertReviewDoc, convertStatusDoc, convertTransferActivityDoc, convertUserProtocolCollectionsDoc, convertListActivityDoc } from 'bitbadgesjs-utils';
import crypto from 'crypto-js';

const { SHA256 } = crypto;


config();

export let MONGO_CONNECTED = false;
mongoose.connect(`${process.env.DB_URL}`);
export const MongoDB = mongoose.connection;
MongoDB.on('error', console.error.bind(console, 'MongoDB connection error:'));
MongoDB.once('open', () => {
  MONGO_CONNECTED = true;
  console.log('Connected to MongoDB');
});

export interface PageVisitsDoc<T extends NumberType> {
  _id: string;
  _legacyId: string;
  collectionId?: T;
  mappingId?: string;
  lastUpdated: number;
  overallVisits: {
    daily: T,
    weekly: T,
    monthly: T,
    yearly: T,
    allTime: T,
  };
  badgePageVisits?: {
    daily: Balance<T>[],
    weekly: Balance<T>[],
    monthly: Balance<T>[],
    yearly: Balance<T>[],
    allTime: Balance<T>[],
  };
}

export function convertPageVisitsDoc<T extends NumberType, U extends NumberType>(item: PageVisitsDoc<T>, convertFunction: (item: T) => U): PageVisitsDoc<U> {
  return {
    ...item,
    collectionId: item.collectionId ? convertFunction(item.collectionId) : undefined,
    overallVisits: {
      daily: convertFunction(item.overallVisits.daily),
      weekly: convertFunction(item.overallVisits.weekly),
      monthly: convertFunction(item.overallVisits.monthly),
      yearly: convertFunction(item.overallVisits.yearly),
      allTime: convertFunction(item.overallVisits.allTime),
    },
    badgePageVisits: item.badgePageVisits ? {
      daily: item.badgePageVisits.daily.map(x => convertBalance(x, convertFunction)),
      weekly: item.badgePageVisits.weekly.map(x => convertBalance(x, convertFunction)),
      monthly: item.badgePageVisits.monthly.map(x => convertBalance(x, convertFunction)),
      yearly: item.badgePageVisits.yearly.map(x => convertBalance(x, convertFunction)),
      allTime: item.badgePageVisits.allTime.map(x => convertBalance(x, convertFunction)),
    } : undefined,
  }
}


export interface BrowseDoc<T extends NumberType> {
  _legacyId: string;
  _id?: string;
  collections: {
    [category: string]: NumberType[];
  };
  addressMappings: {
    [category: string]: string[];
  };
  profiles: {
    [category: string]: string[];
  };
  badges: {
    [category: string]: {
      badgeIds: UintRange<T>[];
      collectionId: T;
    }[];
  };
}

export interface ApiKeyDoc {
  _legacyId: string;
  _id?: string
  numRequests: number;
  lastRequest: number;
}

export interface ReportDoc {
  _legacyId: string;
  _id?: string
  collectionId?: number;
  mappingId?: string;
  addressOrUsername?: string;
  reason: string;
}

export interface EthTxCountDoc {
  _legacyId: string;
  _id?: string
  count: number;
  lastFetched: number;
}

export interface OffChainUrlDoc {
  _legacyId: string;
  _id?: string
  collectionId: number;
}

export type BitBadgesDoc<T extends NumberType> = TransferActivityDoc<T> | ReviewDoc<T> | AnnouncementDoc<T> | ActivityDoc<T> | ProfileDoc<T> | AccountDoc<T> | CollectionDoc<T> | StatusDoc<T> | PasswordDoc<T> | BalanceDoc<T> | MerkleChallengeDoc<T> | FetchDoc<T> | QueueDoc<T> | RefreshDoc<T> | IPFSTotalsDoc<T> | ErrorDoc | AirdropDoc<T> | ApprovalsTrackerDoc<T> | AddressMappingDoc<T> | ApiKeyDoc | ClaimAlertDoc<T> | EthTxCountDoc | OffChainUrlDoc | ReportDoc | ComplianceDoc<T> | BlockinAuthSignatureDoc<T> | FollowDetailsDoc<T> | BrowseDoc<T> | ProtocolDoc<T> | UserProtocolCollectionsDoc<T> | ListActivityDoc<T> | PageVisitsDoc<T>

//TODO: Better schemas?
const Schema = mongoose.Schema;

export const PageVisitsSchema = new Schema({
  _legacyId: String,
  collectionId: Number,
  mappingId: String,
  overallVisits: Schema.Types.Mixed,
  badgePageVisits: Schema.Types.Mixed,
});

export const BrowseSchema = new Schema({
  _legacyId: String,
  collections: Schema.Types.Mixed,
  addressMappings: Schema.Types.Mixed,
  profiles: Schema.Types.Mixed,
  badges: Schema.Types.Mixed,
});

export const ApiKeySchema = new Schema({
  _legacyId: String,
  numRequests: Number,
  lastRequest: Number,
});

export const ErrorSchema = new Schema({
  error: Schema.Types.Mixed,
  _legacyId: String,

});

export const OffChainUrlSchema = new Schema({
  collectionId: Number,
  _legacyId: String,
});

export const ReportSchema = new Schema({
  _legacyId: String,
  collectionId: Number,
  mappingId: String,
  addressOrUsername: String,
  reason: String,
});


export const EthTxCountSchema = new Schema({
  _legacyId: String,
  count: Number,
  lastFetched: Number,
});

export interface UsernameDoc {
  _legacyId: string;
  _id: string;
}
export const UsernameSchema = new Schema({
  _legacyId: String,
});

//set minimize to false to avoid issues with empty objects
PasswordSchema.set('minimize', false); //claimedUsers is {} by default

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
export const PasswordModel = mongoose.model<PasswordDoc<JSPrimitiveNumberType>>('passwords', PasswordSchema);
export const ProfileModel = mongoose.model<ProfileDoc<JSPrimitiveNumberType>>('profiles', ProfileSchema);
export const TransferActivityModel = mongoose.model<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activity', TransferActivitySchema);
export const AnnouncementModel = mongoose.model<AnnouncementDoc<JSPrimitiveNumberType>>('announcements', AnnouncementSchema);
export const ReviewModel = mongoose.model<ReviewDoc<JSPrimitiveNumberType>>('reviews', ReviewSchema);
export const ErrorModel = mongoose.model<ErrorDoc>('errors', ErrorSchema);
export const IPFSTotalsModel = mongoose.model<IPFSTotalsDoc<JSPrimitiveNumberType>>('ipfs-totals', IPFSTotalsSchema);
export const AirdropModel = mongoose.model<AirdropDoc<JSPrimitiveNumberType>>('airdrop', AirdropSchema);
export const AddressMappingModel = mongoose.model<AddressMappingDoc<JSPrimitiveNumberType>>('address-mappings', AddressMappingSchema);
export const ApprovalsTrackerModel = mongoose.model<ApprovalsTrackerDoc<JSPrimitiveNumberType>>('approvals-trackers', ApprovalsTrackerSchema);
export const ClaimAlertModel = mongoose.model<ClaimAlertDoc<JSPrimitiveNumberType>>('claim-alerts', ClaimAlertSchema);
export const EthTxCountModel = mongoose.model<EthTxCountDoc>('eth-tx-count', EthTxCountSchema);
export const OffChainUrlModel = mongoose.model<OffChainUrlDoc>('off-chain-urls', OffChainUrlSchema);
export const ReportModel = mongoose.model<ReportDoc>('reports', ReportSchema);
export const ComplianceModel = mongoose.model<ComplianceDoc<JSPrimitiveNumberType>>('compliance', ComplianceSchema);
export const BlockinAuthSignatureModel = mongoose.model<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>('auth-codes', BlockinAuthSignatureSchema);
export const FollowDetailsModel = mongoose.model<FollowDetailsDoc<JSPrimitiveNumberType>>('follows', FollowDetailsSchema);
export const UsernameModel = mongoose.model<UsernameDoc>('usernames', UsernameSchema);
export const ProtocolModel = mongoose.model<ProtocolDoc<JSPrimitiveNumberType>>('protocols', ProtocolSchema);
export const UserProtocolCollectionsModel = mongoose.model<UserProtocolCollectionsDoc<JSPrimitiveNumberType>>('user-collection-protocols', UserProtocolCollectionsSchema);
export const ListActivityModel = mongoose.model<ListActivityDoc<JSPrimitiveNumberType>>('list-activity', ListActivitySchema);
export const PageVisitsModel = mongoose.model<PageVisitsDoc<JSPrimitiveNumberType>>('page-visits', PageVisitsSchema);

export async function getManyFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[],
  session?: mongoose.mongo.ClientSession
) {
  const query = model.find({ _legacyId: { $in: ids } }).limit(ids.length).lean();
  if (session) {
    query.session(session);
  }
  const res = await query.exec();


  return ids.map(id => res.find(x => x._legacyId === id)).map(x => {
    if (!x) return undefined;
    return {
      ...x, _id: x._id ? x._id.toString() : undefined
    } as T;
  });
}

export async function mustGetManyFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[],
  session?: mongoose.mongo.ClientSession
) {
  const res = await getManyFromDB(model, ids, session);
  for (const id of ids) {
    if (!res.find(x => x?._legacyId === id)) {
      throw `Error in mustGetManyFromDB(): Could not find doc w/ id ${id}`;
    }
  }

  //no undefined
  return res as T[];
}

export async function getFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  id: string,
  session?: mongoose.mongo.ClientSession
) {
  const query = model.find({ _legacyId: id }).limit(1).lean();
  if (session) {
    query.session(session);
  }
  const res = await query.exec();

  //if ID is not found, return undefined

  return res.length > 0 ? {
    ...res[0], _id: res[0]._id ? res[0]._id.toString() : undefined
  } as T : undefined;
}

export async function mustGetFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  id: string,
  session?: mongoose.mongo.ClientSession
) {
  const query = model.find({ _legacyId: id }).limit(1).lean();
  if (session) {
    query.session(session);
  }

  const res = await query.exec();
  if (res.length === 0) {
    throw `Error in mustGetFromDB(): Could not find doc w/ id ${id}`;
  }

  return {
    ...res[0], _id: res[0]._id ? res[0]._id.toString() : undefined
  } as T;
}

export async function insertToDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>), U extends (BitBadgesDoc<NumberType>)>(
  model: mongoose.Model<T>,
  doc: U,
  session?: mongoose.mongo.ClientSession
) {
  await insertMany(model, [doc], session);
}

export async function insertMany<T extends (BitBadgesDoc<JSPrimitiveNumberType>), U extends (BitBadgesDoc<NumberType>)>(
  model: mongoose.Model<T>,
  docs: U[],
  session?: mongoose.mongo.ClientSession
) {
  try {
    const convertedDocs = await convertDocsToStoreInDb(model, docs);

    const docsToInsert = convertedDocs.map(x => {
      const hexHashString = SHA256(x._legacyId).toString();
      //24 character limit
      const shortenedHexHashString = hexHashString.slice(0, 24);
      return {
        ...x,
        _id: x._id ?? new mongoose.Types.ObjectId(shortenedHexHashString).toString() //We use a deterministic _id based on _legacyId which is going to be unique
      }
    });

    // if (docsToInsert.length > 1000) console.time('insertMany');
    const bulkOps = docsToInsert.map(doc => ({
      updateOne: {
        filter: { _id: doc._id },
        update: doc,
        upsert: true,
      },
    }));
    await model.bulkWrite(bulkOps as any, { session });

    // if (docsToInsert.length > 1000) console.timeEnd('insertMany');


  } catch (e) {
    console.log(e);
    throw e;
  }
}

export async function deleteMany<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[],
  session: mongoose.mongo.ClientSession | undefined = undefined
) {
  try {
    await model.deleteMany({ _legacyId: { $in: ids } }, { session });
  } catch (e) {
    throw e;
  }
}

export async function convertDocsToStoreInDb<T extends (BitBadgesDoc<JSPrimitiveNumberType>), U extends (BitBadgesDoc<NumberType>)>(
  model: mongoose.Model<T>,
  docs: U[]
) {
  const convertedDocs: (BitBadgesDoc<JSPrimitiveNumberType>)[] = [];
  for (const doc of docs) {
    let convertedDoc = undefined;
    if (model.modelName === StatusModel.modelName) {
      convertedDoc = convertStatusDoc(doc as StatusDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === AccountModel.modelName) {
      convertedDoc = convertAccountDoc(doc as AccountDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === CollectionModel.modelName) {
      convertedDoc = convertCollectionDoc(doc as CollectionDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === BalanceModel.modelName) {
      convertedDoc = convertBalanceDoc(doc as BalanceDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === MerkleChallengeModel.modelName) {
      convertedDoc = convertMerkleChallengeDoc(doc as MerkleChallengeDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === FetchModel.modelName) {
      convertedDoc = convertFetchDoc(doc as FetchDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === QueueModel.modelName) {
      convertedDoc = convertQueueDoc(doc as QueueDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === RefreshModel.modelName) {
      convertedDoc = convertRefreshDoc(doc as RefreshDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === PasswordModel.modelName) {
      convertedDoc = convertPasswordDoc(doc as PasswordDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ProfileModel.modelName) {
      convertedDoc = convertProfileDoc(doc as ProfileDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === TransferActivityModel.modelName) {
      convertedDoc = convertTransferActivityDoc(doc as TransferActivityDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === AnnouncementModel.modelName) {
      convertedDoc = convertAnnouncementDoc(doc as AnnouncementDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ReviewModel.modelName) {
      convertedDoc = convertReviewDoc(doc as ReviewDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ErrorModel.modelName) {
      convertedDoc = doc as ErrorDoc;
    } else if (model.modelName === IPFSTotalsModel.modelName) {
      convertedDoc = convertIPFSTotalsDoc(doc as IPFSTotalsDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === AirdropModel.modelName) {
      convertedDoc = convertAirdropDoc(doc as AirdropDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === AddressMappingModel.modelName) {
      convertedDoc = convertAddressMappingDoc(doc as AddressMappingDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ApprovalsTrackerModel.modelName) {
      convertedDoc = convertApprovalsTrackerDoc(doc as ApprovalsTrackerDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ApiKeyModel.modelName) {
      convertedDoc = doc as ApiKeyDoc;
    } else if (model.modelName === ClaimAlertModel.modelName) {
      convertedDoc = convertClaimAlertDoc(doc as ClaimAlertDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === EthTxCountModel.modelName) {
      convertedDoc = doc as EthTxCountDoc;
    } else if (model.modelName === OffChainUrlModel.modelName) {
      convertedDoc = doc as OffChainUrlDoc;
    } else if (model.modelName === ReportModel.modelName) {
      convertedDoc = doc as ReportDoc;
    } else if (model.modelName === ComplianceModel.modelName) {
      convertedDoc = convertComplianceDoc(doc as ComplianceDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === BlockinAuthSignatureModel.modelName) {
      convertedDoc = convertBlockinAuthSignatureDoc(doc as BlockinAuthSignatureDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === FollowDetailsModel.modelName) {
      convertedDoc = convertFollowDetailsDoc(doc as FollowDetailsDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === BrowseModel.modelName) {
      convertedDoc = doc as BrowseDoc<NumberType>;
    } else if (model.modelName === ProtocolModel.modelName) {
      convertedDoc = convertProtocolDoc(doc as ProtocolDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === UserProtocolCollectionsModel.modelName) {
      convertedDoc = convertUserProtocolCollectionsDoc(doc as UserProtocolCollectionsDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === ListActivityModel.modelName) {
      convertedDoc = convertListActivityDoc(doc as ListActivityDoc<NumberType>, NumberifyIfPossible);
    } else if (model.modelName === PageVisitsModel.modelName) {
      convertedDoc = convertPageVisitsDoc(doc as PageVisitsDoc<NumberType>, NumberifyIfPossible);
    }

    const docToAdd = {
      ...convertedDoc as BitBadgesDoc<JSPrimitiveNumberType>,
      _id: convertedDoc?._id && typeof convertedDoc?._id === 'string' ? convertedDoc?._id : undefined //HACK: _id is "{}" when using .lean() so this just filters those ones out and makes them undefined.
    }
    convertedDocs.push(docToAdd);
  }

  return convertedDocs;
}

