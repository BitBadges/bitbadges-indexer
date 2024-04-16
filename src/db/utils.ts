import { JSPrimitiveNumberType, PaginationInfo } from "bitbadgesjs-sdk";
import mongoose from "mongoose";
import { findInDB } from "./queries";
import { BitBadgesDoc, TypedDocFromModel } from "./schemas";

export const pageSize = 25;

export async function findWithPagination<T extends BitBadgesDoc<JSPrimitiveNumberType>, S extends TypedDocFromModel<T>>(
  model: mongoose.Model<T>,
  options: {
    query: mongoose.FilterQuery<T>;
    session?: mongoose.mongo.ClientSession;
    limit?: number;
    skip?: number;
    sort?: any;
  }
): Promise<{ docs: S[]; pagination: PaginationInfo }> {
  const docs = await findInDB<T, S>(model, options);
  return {
    docs,
    pagination: getPaginationInfoToReturn(docs)
  };
}

export const getPaginationInfoToReturn = (docs: any[]) => {
  const newBookmark = docs.length > 0 ? docs[docs.length - 1]._id.toString() : undefined;
  return {
    bookmark: newBookmark ?? '',
    hasMore: docs.length === pageSize
  };
};

// A little naive bc we always assume descending (-1) sort order
// But basically what this does is ensures the query starts at the last fetched doc + 1
// If we have duplicate primary sort fields, we need to handle based on the secondary sort field
export const getQueryParamsFromBookmark = async (
  model: mongoose.Model<any>,
  bookmark: string | undefined,
  oldestFirst: boolean | undefined,
  primarySort: string,
  secondarySort?: string
) => {
  let lastFetchedDoc: any = null;
  if (bookmark) {
    lastFetchedDoc = await model.findOne({ _id: bookmark }).lean().exec();
  }

  const operator = oldestFirst ? '$gt' : '$lt';

  if (secondarySort) {
    return {
      $or: lastFetchedDoc
        ? [
            {
              [primarySort]: { $eq: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] },
              [secondarySort]: {
                [`${operator}`]: lastFetchedDoc[secondarySort as keyof typeof lastFetchedDoc]
              }
            },
            {
              [primarySort]: {
                [`${operator}`]: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc]
              }
            }
          ]
        : [
            {
              [primarySort]: { $exists: true }
            }
          ]
    };
  } else {
    return {
      [primarySort]: lastFetchedDoc ? { [`${operator}`]: lastFetchedDoc[primarySort as keyof typeof lastFetchedDoc] } : { $exists: true }
    };
  }
};
