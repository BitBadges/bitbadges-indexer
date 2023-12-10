import { JSPrimitiveNumberType, NumberType, NumberifyIfPossible } from 'bitbadgesjs-proto';
import { config } from "dotenv";
import mongoose from 'mongoose';

import { AccountDoc, AccountSchema, ActivityDoc, AddressMappingDoc, AddressMappingSchema, AirdropDoc, AirdropSchema, AnnouncementDoc, AnnouncementSchema, ApprovalsTrackerDoc, ApprovalsTrackerSchema, BalanceDoc, BalanceSchema, BlockinAuthSignatureDoc, BlockinAuthSignatureSchema, ChallengeSchema, ClaimAlertDoc, ClaimAlertSchema, CollectionDoc, CollectionSchema, ComplianceDoc, ComplianceSchema, ErrorDoc, FetchDoc, FetchSchema, FollowDetailsDoc, FollowDetailsSchema, IPFSTotalsDoc, IPFSTotalsSchema, MerkleChallengeDoc, PasswordDoc, PasswordSchema, ProfileDoc, ProfileSchema, QueueDoc, QueueSchema, RefreshDoc, RefreshSchema, ReviewDoc, ReviewSchema, StatusDoc, StatusSchema, TransferActivityDoc, TransferActivitySchema, convertAccountDoc, convertAddressMappingDoc, convertAirdropDoc, convertAnnouncementDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertBlockinAuthSignatureDoc, convertClaimAlertDoc, convertCollectionDoc, convertComplianceDoc, convertFetchDoc, convertFollowDetailsDoc, convertIPFSTotalsDoc, convertMerkleChallengeDoc, convertPasswordDoc, convertProfileDoc, convertQueueDoc, convertRefreshDoc, convertReviewDoc, convertStatusDoc, convertTransferActivityDoc } from 'bitbadgesjs-utils';

config();
mongoose.connect(`${process.env.DB_URL}`);
export const MongoDB = mongoose.connection;
MongoDB.on('error', console.error.bind(console, 'MongoDB connection error:'));
MongoDB.once('open', () => {
  console.log('Connected to MongoDB');
});

export interface ApiKeyDoc {
  _legacyId: string;
  numRequests: number;
  lastRequest: number;
}

export interface ReportDoc {
  _legacyId: string;
  collectionId?: number;
  mappingId?: string;
  addressOrUsername?: string;
  reason: string;
}

export interface EthTxCountDoc {
  _legacyId: string;
  count: number;
  lastFetched: number;
}

export interface MsgDoc {
  _legacyId: string;
  msg?: any;
  type: string;
  txHash: string;
  txIndex: number;
  msgIndex: number;
  block: number;
  blockTimestamp: number;
  collectionId?: bigint;
  creator?: string;
}

export interface OffChainUrlDoc {
  _legacyId: string;
  collectionId: number;
}

export type BitBadgesDoc<T extends NumberType> = TransferActivityDoc<T> | ReviewDoc<T> | AnnouncementDoc<T> | ActivityDoc<T> | ProfileDoc<T> | AccountDoc<T> | CollectionDoc<T> | StatusDoc<T> | PasswordDoc<T> | BalanceDoc<T> | MerkleChallengeDoc<T> | FetchDoc<T> | QueueDoc<T> | RefreshDoc<T> | IPFSTotalsDoc<T> | ErrorDoc | AirdropDoc<T> | ApprovalsTrackerDoc<T> | AddressMappingDoc<T> | ApiKeyDoc | ClaimAlertDoc<T> | EthTxCountDoc | MsgDoc | OffChainUrlDoc | ReportDoc | ComplianceDoc<T> | BlockinAuthSignatureDoc<T> | FollowDetailsDoc<T>

//TODO: Better schemas?
const Schema = mongoose.Schema;

export const ApiKeySchema = new Schema({
  _legacyId: String,
  numRequests: Number,
  lastRequest: Number,
});

export const ErrorSchema = new Schema({
  error: Schema.Types.Mixed,
  _legacyId: String,

});

export const MsgSchema = new Schema({
  _legacyId: String,
  msg: Schema.Types.Mixed,
  type: String,
  txHash: String,
  txIndex: Number,
  msgIndex: Number,
  block: Number,
  blockTimestamp: Number,
  collectionId: Number,
  creator: String,
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
}
export const UsernameSchema = new Schema({
  _legacyId: String,
});

//set minimize to false to avoid issues with empty objects
PasswordSchema.set('minimize', false); //claimedUsers is {} by default

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
export const MsgModel = mongoose.model<MsgDoc>('msgs', MsgSchema);
export const OffChainUrlModel = mongoose.model<OffChainUrlDoc>('off-chain-urls', OffChainUrlSchema);
export const ReportModel = mongoose.model<ReportDoc>('reports', ReportSchema);
export const ComplianceModel = mongoose.model<ComplianceDoc<JSPrimitiveNumberType>>('compliance', ComplianceSchema);
export const BlockinAuthSignatureModel = mongoose.model<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>('auth-codes', BlockinAuthSignatureSchema);
export const FollowDetailsModel = mongoose.model<FollowDetailsDoc<JSPrimitiveNumberType>>('follows', FollowDetailsSchema);
export const UsernameModel = mongoose.model<UsernameDoc>('usernames', UsernameSchema);

export async function getManyFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[]
) {
  const res = await model.find({ _legacyId: { $in: ids } }).limit(ids.length).lean().exec();
  return ids.map(id => res.find(x => x._legacyId === id)) as (T | undefined)[];
}

export async function mustGetManyFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[]
) {
  const res = await getManyFromDB(model, ids);
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
  id: string
) {
  const res = await model.find({ _legacyId: id }).limit(1).lean().exec();

  return res.length > 0 ? res[0] as T : undefined;
}

export async function mustGetFromDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  id: string
) {
  const res = await model.find({ _legacyId: id }).limit(1).lean().exec();
  if (res.length === 0) {
    throw `Error in mustGetFromDB(): Could not find doc w/ id ${id}`;
  }

  return res[0] as T
}

export async function insertToDB<T extends (BitBadgesDoc<JSPrimitiveNumberType>), U extends (BitBadgesDoc<NumberType>)>(
  model: mongoose.Model<T>,
  doc: U,
  session?: mongoose.mongo.ClientSession
) {
  const convertedDocs = await convertDocsToStoreInDb(model, [doc]);
  if (model.modelName === PasswordModel.modelName) {
    console.log(convertedDocs);
    console.log({ ...convertedDocs[0] });
  }

  const currDoc = await model.exists({ _legacyId: convertedDocs[0]._legacyId });
  if (!currDoc) {
    await model.create(convertedDocs[0]);
  } else {
    await model.findOneAndUpdate({ _legacyId: convertedDocs[0]._legacyId }, { ...convertedDocs[0], _id: currDoc._id }, { upsert: true, new: true, session });
  }
}

export async function insertMany<T extends (BitBadgesDoc<JSPrimitiveNumberType>), U extends (BitBadgesDoc<NumberType>)>(
  model: mongoose.Model<T>,
  docs: U[],
  session?: mongoose.mongo.ClientSession
) {
  const passedInSession = !!session;
  if (!passedInSession) {
    session = await MongoDB.startSession();
    session.startTransaction();
  }
  try {

    const convertedDocs = await convertDocsToStoreInDb(model, docs);

    //TODO: Apparently, there are issues with using Promise.all() with transactions / sessions. Can look into this, but this is fast for now.
    for (const doc of convertedDocs) {
      await insertToDB(model, doc, session);
    }

    if (!passedInSession && session) {
      await session.commitTransaction();
      await session.endSession();
    } else {
      //It is handled by the caller
    }
  } catch (e) {
    if (!passedInSession && session) {
      await session.abortTransaction();
      await session.endSession();
    } else {
      //It is handled by the caller
    }

    throw e;
  }
}

export async function deleteMany<T extends (BitBadgesDoc<JSPrimitiveNumberType>)>(
  model: mongoose.Model<T>,
  ids: string[],
  session: mongoose.mongo.ClientSession | undefined = undefined
) {
  const passedInSession = !!session;
  if (!passedInSession) {
    session = await MongoDB.startSession();
    session.startTransaction();
  }

  try {
    await model.deleteMany({ _legacyId: { $in: ids } }, { session });

    if (!passedInSession && session) {
      await session.commitTransaction();
      await session.endSession();
    } else {
      //It is handled by the caller
    }
  } catch (e) {

    if (!passedInSession && session) {
      await session.abortTransaction();
      await session.endSession();
    } else {
      //It is handled by the caller
    }

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
    } else if (model.modelName === MsgModel.modelName) {
      convertedDoc = doc as MsgDoc;
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
    }

    const docToAdd = convertedDoc as BitBadgesDoc<JSPrimitiveNumberType>;
    convertedDocs.push(docToAdd);
  }

  return convertedDocs;
}

