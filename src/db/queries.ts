import { BigIntify, type JSPrimitiveNumberType } from 'bitbadgesjs-sdk';
import type mongoose from 'mongoose';
import { convertDocs } from './db';
import { type BitBadgesDoc, type TypedDocFromModel, type TypedInterfaceFromModel } from './schemas';

export async function findInDB<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  options: {
    query: mongoose.FilterQuery<T>;
    session?: mongoose.mongo.ClientSession;
    limit?: number;
    skip?: number;
    sort?: any;
  }
) {
  let query = model.find(options.query);
  if (options.limit) {
    query = query.limit(options.limit);
  }

  if (options.skip) {
    query = query.skip(options.skip);
  }

  if (options.sort) {
    query = query.sort(options.sort);
  }

  if (options.session) {
    query = query.session(options.session);
  }

  const res = (await query.lean().exec()) as unknown as Array<TypedInterfaceFromModel<T, JSPrimitiveNumberType>>;

  for (const doc of res) {
    doc._id = doc._id ? doc._id.toString() : undefined;
  }

  const docs: S[] = convertDocs(model, res, BigIntify) as unknown as S[];
  return docs;
}
