import {
  AccessTokenDoc,
  AccountDoc,
  AddressListDoc,
  AirdropDoc,
  ApprovalTrackerDoc,
  AttestationDoc,
  AuthorizationCodeDoc,
  BalanceDoc,
  BigIntify,
  ClaimAlertDoc,
  ClaimBuilderDoc,
  CollectionDoc,
  ComplianceDoc,
  DeveloperAppDoc,
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
  SIWBBRequestDoc,
  StatusDoc,
  TransferActivityDoc,
  iAccessTokenDoc,
  iAuthorizationCodeDoc,
  iDeveloperAppDoc,
  iPluginDoc,
  type ErrorDoc,
  type JSPrimitiveNumberType,
  type NumberType,
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
import CryptoJS from 'crypto-js';
import { config } from 'dotenv';

import mongoose from 'mongoose';
import typia from 'typia';
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
  AuthorizationCodeModel,
  BalanceModel,
  BrowseModel,
  ClaimAlertModel,
  ClaimAttemptStatusModel,
  ClaimBuilderModel,
  ClaimDocHistoryModel,
  CollectionModel,
  ComplianceModel,
  DeveloperAppModel,
  DigitalOceanBalancesModel,
  ErrorModel,
  EthTxCountModel,
  FetchModel,
  FollowDetailsModel,
  IPFSTotalsModel,
  ListActivityModel,
  MapModel,
  MerkleChallengeModel,
  OffChainAttestationsModel,
  OffChainUrlModel,
  PageVisitsModel,
  PluginDocHistoryModel,
  PluginModel,
  ProfileModel,
  QueueModel,
  RefreshModel,
  ReportModel,
  ReviewModel,
  SIWBBRequestModel,
  StatusModel,
  TransferActivityModel,
  type BitBadgesDoc,
  type TypedDocFromModel,
  type TypedInterfaceFromModel
} from './schemas';

import { MongoClient, ClientEncryption } from 'mongodb';

// For running
// import mongodb from 'mongodb';
// const { MongoClient, ClientEncryption } = mongodb;

const { SHA256 } = CryptoJS;

config();

export let MONGO_CONNECTED = false;
export const MongoDB = mongoose.connection;
const symKey = process.env.SYM_KEY ?? '';
if (!symKey) {
  throw new Error('No sym key provided');
}

const key = Buffer.from(symKey, 'base64');

export const keyVaultNamespace = 'encryption.__dataKeys';
export const kmsProviders = { local: { key } };

const uri = process.env.DB_URL ?? '';

async function run() {
  const client = new MongoClient(uri);
  await client.connect();

  const encryption = new ClientEncryption(client, {
    keyVaultNamespace,
    kmsProviders
  });

  let _key;
  const existingKeys = await encryption.getKeys().toArray();

  if (existingKeys?.[0]) {
    await client.close();
    _key = existingKeys?.[0]._id;
  } else {
    _key = await encryption.createDataKey('local');
    await client.close();
  }

  const dbName = 'bitbadges';
  const schemaMap = {
    [`${dbName}.${ClaimBuilderModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        state: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        plugins: {
          encrypt: {
            bsonType: 'array',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        action: {
          bsonType: 'object',
          properties: {
            codes: {
              encrypt: {
                bsonType: 'array',
                algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
              }
            },
            seedCode: {
              encrypt: {
                bsonType: 'string',
                algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
              }
            }
          }
        }
      }
    },
    [`${dbName}.${ApiKeyModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        numRequests: {
          bsonType: 'int'
        },
        lastRequest: {
          bsonType: 'int'
        }
      }
    },
    [`${dbName}.${SIWBBRequestModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        signature: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        params: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        attestationsPresentations: {
          encrypt: {
            bsonType: 'array',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        otherSignIns: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },

    [`${dbName}.${OffChainAttestationsModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        holders: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          }
        },
        proofOfIssuance: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        attestationMessages: {
          encrypt: {
            bsonType: 'array',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        dataIntegrityProof: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },

    [`${dbName}.${AddressListModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        addresses: {
          bsonType: 'array',
          items: {
            bsonType: 'string'
          }
        }
      }
    },

    [`${dbName}.${QueueModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        emailMessage: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        recipientAddress: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        claimInfo: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${ProfileModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        socialConnections: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        approvedSignInMethods: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        notifications: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        watchlists: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${ClaimAlertModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        message: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${PluginModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        pluginSecret: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${DeveloperAppModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        clientSecret: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${PluginDocHistoryModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        prevDoc: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${ClaimDocHistoryModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        prevDoc: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    },
    [`${dbName}.${ClaimAttemptStatusModel.modelName}`]: {
      bsonType: 'object',
      encryptMetadata: {
        keyId: [_key]
      },
      properties: {
        error: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        claimInfo: {
          encrypt: {
            bsonType: 'object',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        },
        code: {
          encrypt: {
            bsonType: 'string',
            algorithm: 'AEAD_AES_256_CBC_HMAC_SHA_512-Random'
          }
        }
      }
    }
  };

  await mongoose
    .connect(`${process.env.DB_URL}`, {
      autoEncryption: {
        keyVaultNamespace,
        kmsProviders,
        schemaMap
      }
    })
    .catch((e) => {
      console.error('Error connecting to MongoDB:', e);
    });
}

run().catch((err) => console.log(err));

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
    throw new Error(`Error in mustGetFromDB(): Could not find doc w/ id ${id} in ${model.modelName}`);
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

function removeNullAndUndefinedRecursive(obj: any | null | undefined): any | null | undefined {
  if (obj === null || obj === undefined) {
    return undefined;
  }

  if (Array.isArray(obj)) {
    return obj.map((x) => removeNullAndUndefinedRecursive(x));
  }

  if (typeof obj === 'object') {
    const newObj: Record<string, any> = {};
    for (const key in obj) {
      const val = removeNullAndUndefinedRecursive(obj[key]);
      if (val !== undefined) {
        newObj[key] = val;
      }
    }

    return newObj;
  }

  return obj;
}

export function convertDocs<T extends BitBadgesDoc<JSPrimitiveNumberType>, U extends TypedInterfaceFromModel<T, NumberType>, V extends NumberType>(
  model: mongoose.Model<T>,
  docs: Array<U | undefined> | (U | undefined),
  convertFunction: (val: NumberType) => V
) {
  docs = Array.isArray(docs) ? docs : [docs];

  const convertedDocs: Array<BitBadgesDoc<V> | undefined> = [];
  for (let doc of docs) {
    if (!doc) {
      convertedDocs.push(undefined);
      continue;
    }

    let convertedDoc: BitBadgesDoc<V> | undefined;

    // HACK: _id is "{}" when using .lean() so this just filters those ones out and makes them undefined.
    doc._id = doc._id ? doc._id.toString() : undefined;
    doc = removeNullAndUndefinedRecursive(doc);

    //Convert according to model name

    if (model.modelName === StatusModel.modelName) {
      convertedDoc = new StatusDoc(doc as iStatusDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iStatusDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === AccountModel.modelName) {
      convertedDoc = new AccountDoc(doc as iAccountDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAccountDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === CollectionModel.modelName) {
      convertedDoc = new CollectionDoc(doc as iCollectionDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iCollectionDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === BalanceModel.modelName) {
      convertedDoc = new BalanceDoc(doc as iBalanceDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iBalanceDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) {
        throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
      }
    } else if (model.modelName === MerkleChallengeModel.modelName) {
      convertedDoc = new MerkleChallengeDoc(doc as iMerkleChallengeDoc<NumberType>).convert(convertFunction);
      const validateRes =
        process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iMerkleChallengeDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === FetchModel.modelName) {
      convertedDoc = new FetchDoc(doc as iFetchDoc<NumberType>).convert(convertFunction);
      // const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iFetchDoc<NumberType>>(convertedDoc);
      // if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === QueueModel.modelName) {
      convertedDoc = new QueueDoc(doc as iQueueDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iQueueDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === RefreshModel.modelName) {
      convertedDoc = new RefreshDoc(doc as iRefreshDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iRefreshDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ClaimBuilderModel.modelName) {
      const docToInsert = doc as iClaimBuilderDoc<NumberType>;
      docToInsert.action.seedCode = docToInsert.action.seedCode ?? '';
      docToInsert.action.codes = docToInsert.action.codes ?? [];

      convertedDoc = new ClaimBuilderDoc(docToInsert as iClaimBuilderDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iClaimBuilderDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ProfileModel.modelName) {
      convertedDoc = new ProfileDoc(doc as iProfileDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iProfileDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === TransferActivityModel.modelName) {
      convertedDoc = new TransferActivityDoc(doc as iTransferActivityDoc<NumberType>).convert(convertFunction);
      const validateRes =
        process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iTransferActivityDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) {
        throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
      }
    } else if (model.modelName === ReviewModel.modelName) {
      convertedDoc = new ReviewDoc(doc as iReviewDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iReviewDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ErrorModel.modelName) {
      convertedDoc = doc as ErrorDoc;
    } else if (model.modelName === IPFSTotalsModel.modelName) {
      convertedDoc = new IPFSTotalsDoc(doc as iIPFSTotalsDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iIPFSTotalsDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === AirdropModel.modelName) {
      convertedDoc = new AirdropDoc(doc as iAirdropDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAirdropDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === AddressListModel.modelName) {
      convertedDoc = new AddressListDoc(doc as iAddressListDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAddressListDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ApprovalTrackerModel.modelName) {
      convertedDoc = new ApprovalTrackerDoc(doc as iApprovalTrackerDoc<NumberType>).convert(convertFunction);
      const validateRes =
        process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iApprovalTrackerDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ApiKeyModel.modelName) {
      convertedDoc = doc as ApiKeyDoc;
    } else if (model.modelName === ClaimAlertModel.modelName) {
      convertedDoc = new ClaimAlertDoc(doc as iClaimAlertDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iClaimAlertDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === EthTxCountModel.modelName) {
      convertedDoc = doc as EthTxCountDoc;
    } else if (model.modelName === OffChainUrlModel.modelName) {
      convertedDoc = doc as OffChainUrlDoc;
    } else if (model.modelName === ReportModel.modelName) {
      convertedDoc = doc as ReportDoc;
    } else if (model.modelName === ComplianceModel.modelName) {
      convertedDoc = new ComplianceDoc(doc as iComplianceDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iComplianceDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === SIWBBRequestModel.modelName) {
      const docToInsert = doc as iSIWBBRequestDoc<NumberType>;
      docToInsert.otherSignIns = docToInsert.otherSignIns ?? {};

      convertedDoc = new SIWBBRequestDoc(docToInsert as iSIWBBRequestDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iSIWBBRequestDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === FollowDetailsModel.modelName) {
      convertedDoc = new FollowDetailsDoc(doc as iFollowDetailsDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iFollowDetailsDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === BrowseModel.modelName) {
      convertedDoc = new BrowseDoc(doc as iBrowseDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iBrowseDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === ListActivityModel.modelName) {
      convertedDoc = new ListActivityDoc(doc as iListActivityDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iListActivityDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === PageVisitsModel.modelName) {
      convertedDoc = new PageVisitsDoc(doc as iPageVisitsDoc<NumberType>).convert(convertFunction);
      // const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iPageVisitsDoc<NumberType>>(convertedDoc);
      // if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === OffChainAttestationsModel.modelName) {
      convertedDoc = new AttestationDoc(doc as iAttestationDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAttestationDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === MapModel.modelName) {
      convertedDoc = new MapDoc(doc as iMapDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iMapDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === DigitalOceanBalancesModel.modelName) {
      convertedDoc = new DigitalOceanBalancesDoc(doc as iDigitalOceanBalancesDoc<NumberType>).convert(convertFunction);
      const validateRes =
        process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iDigitalOceanBalancesDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === DeveloperAppModel.modelName) {
      convertedDoc = new DeveloperAppDoc(doc as iDeveloperAppDoc).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iDeveloperAppDoc>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === PluginModel.modelName) {
      convertedDoc = new PluginDoc(doc as iPluginDoc<NumberType>).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iPluginDoc<NumberType>>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === AuthorizationCodeModel.modelName) {
      convertedDoc = new AuthorizationCodeDoc(doc as iAuthorizationCodeDoc).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAuthorizationCodeDoc>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    } else if (model.modelName === AccessTokenModel.modelName) {
      convertedDoc = new AccessTokenDoc(doc as iAccessTokenDoc).convert(convertFunction);
      const validateRes = process.env.TYPIA === 'true' ? { success: true, errors: [] } : typia.validate<iAccessTokenDoc>(convertedDoc);
      if (!validateRes.success) throw new Error('Invalid doc schema: ' + model.modelName + ' : ' + JSON.stringify(validateRes.errors));
    }

    if (!convertedDoc) throw new Error(`Error in convertDocs(): Could not convert doc w/ _docId ${doc?._docId} to store in DB`);

    // HACK: _id is "{}" when using .lean() so this just filters those ones out and makes them undefined.
    convertedDoc._id = convertedDoc?._id && typeof convertedDoc?._id === 'string' ? convertedDoc?._id : undefined;
    convertedDocs.push(convertedDoc);
  }

  return convertedDocs as Array<TypedDocFromModel<T, V>>;
}
