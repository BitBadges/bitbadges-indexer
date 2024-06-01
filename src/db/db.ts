import {
  AccessTokenDoc,
  AccountDoc,
  AddressListDoc,
  AirdropDoc,
  ApprovalTrackerDoc,
  DeveloperAppDoc,
  AuthorizationCodeDoc,
  BalanceDoc,
  BigIntify,
  SIWBBRequestDoc,
  ClaimAlertDoc,
  ClaimBuilderDoc,
  CollectionDoc,
  ComplianceDoc,
  FetchDoc,
  FollowDetailsDoc,
  IPFSTotalsDoc,
  ListActivityDoc,
  MapDoc,
  MerkleChallengeDoc,
  NumberifyIfPossible,
  PluginDoc,
  ProfileDoc,
  QueueDoc,
  RefreshDoc,
  ReviewDoc,
  SecretDoc,
  StatusDoc,
  TransferActivityDoc,
  iAccessTokenDoc,
  iDeveloperAppDoc,
  iAuthorizationCodeDoc,
  iPluginDoc,
  type ErrorDoc,
  type JSPrimitiveNumberType,
  type NumberType,
  type iAccountDoc,
  type iAddressListDoc,
  type iAirdropDoc,
  type iApprovalTrackerDoc,
  type iBalanceDoc,
  type iSIWBBRequestDoc,
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
  type iSecretDoc,
  type iStatusDoc,
  type iTransferActivityDoc
} from 'bitbadgesjs-sdk';
import crypto from 'crypto-js';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import {
  BrowseDoc,
  DigitalOceanBalancesDoc,
  PageVisitsDoc,
  iDigitalOceanBalancesDoc,
  type ApiKeyDoc,
  type EthTxCountDoc,
  type OffChainUrlDoc,
  type ReportDoc,
  type iBrowseDoc,
  type iPageVisitsDoc
} from './docs';
import {
  AccessTokenModel,
  AccountModel,
  AddressListModel,
  AirdropModel,
  ApiKeyModel,
  ApprovalTrackerModel,
  DeveloperAppModel,
  AuthorizationCodeModel,
  BalanceModel,
  SIWBBRequestModel,
  BrowseModel,
  ClaimAlertModel,
  ClaimBuilderModel,
  CollectionModel,
  ComplianceModel,
  DigitalOceanBalancesModel,
  ErrorModel,
  EthTxCountModel,
  FetchModel,
  FollowDetailsModel,
  IPFSTotalsModel,
  ListActivityModel,
  MapModel,
  MerkleChallengeModel,
  OffChainSecretsModel,
  OffChainUrlModel,
  PageVisitsModel,
  PluginModel,
  ProfileModel,
  QueueModel,
  RefreshModel,
  ReportModel,
  ReviewModel,
  StatusModel,
  TransferActivityModel,
  type BitBadgesDoc,
  type TypedDocFromModel,
  type TypedInterfaceFromModel
} from './schemas';

const { SHA256 } = crypto;

config();

export let MONGO_CONNECTED = false;
mongoose.connect(`${process.env.DB_URL}`).catch((e) => {
  console.error('Error connecting to MongoDB:', e);
});
export const MongoDB = mongoose.connection;
MongoDB.on('error', console.error.bind(console, 'MongoDB connection error:'));
MongoDB.once('open', () => {
  MONGO_CONNECTED = true;
  console.log('Connected to MongoDB');
});

export async function getManyFromDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  ids: string[],
  session?: mongoose.mongo.ClientSession
) {
  let res: Array<TypedInterfaceFromModel<T, JSPrimitiveNumberType>>;
  if (session) {
    res = (await model
      .find({ _docId: { $in: ids } })
      .limit(ids.length)
      .lean()
      .session(session)
      .exec()) as unknown as Array<TypedInterfaceFromModel<T, JSPrimitiveNumberType>>;
  } else {
    res = (await model
      .find({ _docId: { $in: ids } })
      .limit(ids.length)
      .lean()
      .exec()) as unknown as Array<TypedInterfaceFromModel<T, JSPrimitiveNumberType>>;
  }

  if (res.length === 0) {
    return [];
  }

  for (const doc of res) {
    if (!doc) continue;
    doc._id = doc._id ? doc._id.toString() : undefined;
  }

  const convertedDocs: Array<S | undefined> = [];
  for (const id of ids) {
    const doc = res.find((x) => x?._docId === id);
    if (!doc) {
      convertedDocs.push(undefined);
      continue;
    }

    const convertedDoc = convertDocs(model, [doc], BigIntify);
    convertedDocs.push(convertedDoc[0] as S);
  }

  return convertedDocs;
}

export async function mustGetManyFromDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  ids: string[],
  session?: mongoose.mongo.ClientSession
) {
  const res = await getManyFromDB(model, ids, session);
  for (const id of ids) {
    if (!res.find((x) => x?._docId === id)) {
      throw new Error(`Error in mustGetManyFromDB(): Could not find doc w/ id ${id}`);
    }
  }

  return res as S[];
}

export async function getFromDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  id: string,
  session?: mongoose.mongo.ClientSession
) {
  let res;
  if (session) {
    res = await model
      .find({ _docId: { $eq: id } })
      .limit(1)
      .lean()
      .session(session)
      .exec();
  } else {
    res = await model
      .find({ _docId: { $eq: id } })
      .limit(1)
      .lean()
      .exec();
  }

  if (res.length > 0) {
    const docRes = res[0] as unknown as TypedInterfaceFromModel<T, JSPrimitiveNumberType>;
    docRes._id = docRes._id ? docRes._id.toString() : undefined;
    const convertedDocs = convertDocs(model, [docRes], BigIntify);
    return convertedDocs[0] as S;
  } else {
    return undefined;
  }
}

export async function mustGetFromDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  id: string,
  session?: mongoose.mongo.ClientSession
): Promise<S> {
  let res;
  if (session) {
    res = await model
      .find({ _docId: { $eq: id } })
      .limit(1)
      .lean()
      .session(session)
      .exec();
  } else {
    res = await model
      .find({ _docId: { $eq: id } })
      .limit(1)
      .lean()
      .exec();
  }

  if (res.length === 0) {
    throw new Error(`Error in mustGetFromDB(): Could not find doc w/ id ${id}`);
  }

  const docRes = res[0] as unknown as TypedInterfaceFromModel<T, JSPrimitiveNumberType>;
  docRes._id = docRes._id ? docRes._id.toString() : undefined;
  const convertedDocs = convertDocs(model, [docRes], BigIntify);
  return convertedDocs[0] as S;
}

export async function insertToDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends TypedInterfaceFromModel<T, NumberType>>(
  model: mongoose.Model<T>,
  doc: U,
  session?: mongoose.mongo.ClientSession
) {
  await insertMany(model, [doc], session);
}

export async function insertMany<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends TypedInterfaceFromModel<T, NumberType>>(
  model: mongoose.Model<T>,
  docs: U[],
  session?: mongoose.mongo.ClientSession
) {
  try {
    const convertedDocs = convertDocs(model, docs, NumberifyIfPossible);

    const docsToInsert = convertedDocs.map((x) => {
      const hexHashString = SHA256(x._docId).toString();

      // 24 character limit
      const shortenedHexHashString = hexHashString.slice(0, 24);
      x._id = x._id ?? new mongoose.Types.ObjectId(shortenedHexHashString).toString(); // We use a deterministic _id based on _docId which is going to be unique
      return x;
    });

    // if (docsToInsert.length > 1000) console.time('insertMany');
    const bulkOps = docsToInsert.map((doc) => ({
      updateOne: {
        filter: { _id: { $eq: doc._id } },
        update: doc,
        upsert: true
      }
    }));

    await model.bulkWrite(bulkOps as any, { session });

    // if (docsToInsert.length > 1000) console.timeEnd('insertMany');
  } catch (e) {
    console.log(e);
    throw e;
  }
}

export async function deleteMany<T extends BitBadgesDoc<JSPrimitiveNumberType>>(
  model: mongoose.Model<T>,
  ids: string[],
  session: mongoose.mongo.ClientSession | undefined = undefined
) {
  if (ids.length === 0) return;
  await model.deleteMany({ _docId: { $in: ids } }, { session });
}

export function convertDocs<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends TypedInterfaceFromModel<T, NumberType>, V extends NumberType>(
  model: mongoose.Model<T>,
  docs: Array<U | undefined> | (U | undefined),
  convertFunction: (val: NumberType) => V
) {
  docs = Array.isArray(docs) ? docs : [docs];

  const convertedDocs: Array<BitBadgesDoc<V> | undefined> = [];
  for (const doc of docs) {
    if (!doc) {
      convertedDocs.push(undefined);
      continue;
    }

    let convertedDoc: BitBadgesDoc<V> | undefined;

    // HACK: _id is "{}" when using .lean() so this just filters those ones out and makes them undefined.
    doc._id = doc._id ? doc._id.toString() : undefined;

    if (model.modelName === StatusModel.modelName) {
      convertedDoc = new StatusDoc(doc as iStatusDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === AccountModel.modelName) {
      convertedDoc = new AccountDoc(doc as iAccountDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === CollectionModel.modelName) {
      convertedDoc = new CollectionDoc(doc as iCollectionDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === BalanceModel.modelName) {
      convertedDoc = new BalanceDoc(doc as iBalanceDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === MerkleChallengeModel.modelName) {
      convertedDoc = new MerkleChallengeDoc(doc as iMerkleChallengeDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === FetchModel.modelName) {
      convertedDoc = new FetchDoc(doc as iFetchDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === QueueModel.modelName) {
      convertedDoc = new QueueDoc(doc as iQueueDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === RefreshModel.modelName) {
      convertedDoc = new RefreshDoc(doc as iRefreshDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ClaimBuilderModel.modelName) {
      convertedDoc = new ClaimBuilderDoc(doc as iClaimBuilderDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ProfileModel.modelName) {
      convertedDoc = new ProfileDoc(doc as iProfileDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === TransferActivityModel.modelName) {
      convertedDoc = new TransferActivityDoc(doc as iTransferActivityDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ReviewModel.modelName) {
      convertedDoc = new ReviewDoc(doc as iReviewDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ErrorModel.modelName) {
      convertedDoc = doc as ErrorDoc;
    } else if (model.modelName === IPFSTotalsModel.modelName) {
      convertedDoc = new IPFSTotalsDoc(doc as iIPFSTotalsDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === AirdropModel.modelName) {
      convertedDoc = new AirdropDoc(doc as iAirdropDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === AddressListModel.modelName) {
      convertedDoc = new AddressListDoc(doc as iAddressListDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ApprovalTrackerModel.modelName) {
      convertedDoc = new ApprovalTrackerDoc(doc as iApprovalTrackerDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ApiKeyModel.modelName) {
      convertedDoc = doc as ApiKeyDoc;
    } else if (model.modelName === ClaimAlertModel.modelName) {
      convertedDoc = new ClaimAlertDoc(doc as iClaimAlertDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === EthTxCountModel.modelName) {
      convertedDoc = doc as EthTxCountDoc;
    } else if (model.modelName === OffChainUrlModel.modelName) {
      convertedDoc = doc as OffChainUrlDoc;
    } else if (model.modelName === ReportModel.modelName) {
      convertedDoc = doc as ReportDoc;
    } else if (model.modelName === ComplianceModel.modelName) {
      convertedDoc = new ComplianceDoc(doc as iComplianceDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === SIWBBRequestModel.modelName) {
      convertedDoc = new SIWBBRequestDoc(doc as iSIWBBRequestDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === FollowDetailsModel.modelName) {
      convertedDoc = new FollowDetailsDoc(doc as iFollowDetailsDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === BrowseModel.modelName) {
      convertedDoc = new BrowseDoc(doc as iBrowseDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === ListActivityModel.modelName) {
      convertedDoc = new ListActivityDoc(doc as iListActivityDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === PageVisitsModel.modelName) {
      convertedDoc = new PageVisitsDoc(doc as iPageVisitsDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === OffChainSecretsModel.modelName) {
      convertedDoc = new SecretDoc(doc as iSecretDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === MapModel.modelName) {
      convertedDoc = new MapDoc(doc as iMapDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === DigitalOceanBalancesModel.modelName) {
      convertedDoc = new DigitalOceanBalancesDoc(doc as iDigitalOceanBalancesDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === DeveloperAppModel.modelName) {
      convertedDoc = new DeveloperAppDoc(doc as iDeveloperAppDoc).convert(convertFunction);
    } else if (model.modelName === PluginModel.modelName) {
      convertedDoc = new PluginDoc(doc as iPluginDoc<NumberType>).convert(convertFunction);
    } else if (model.modelName === AuthorizationCodeModel.modelName) {
      convertedDoc = new AuthorizationCodeDoc(doc as iAuthorizationCodeDoc).convert(convertFunction);
    } else if (model.modelName === AccessTokenModel.modelName) {
      convertedDoc = new AccessTokenDoc(doc as iAccessTokenDoc).convert(convertFunction);
    }

    if (!convertedDoc) throw new Error(`Error in convertDocs(): Could not convert doc w/ _docId ${doc._docId} to store in DB`);

    // HACK: _id is "{}" when using .lean() so this just filters those ones out and makes them undefined.
    convertedDoc._id = convertedDoc?._id && typeof convertedDoc?._id === 'string' ? convertedDoc?._id : undefined;
    convertedDocs.push(convertedDoc);
  }

  return convertedDocs as Array<TypedDocFromModel<T, V>>;
}
