//Catch function to return rejected promises upon non-404 errors but return undefined for all other errors

import { CouchDBDetailsExcluded } from "bitbadgesjs-utils";
import nano, { DocumentResponseRow, Document } from "nano";

// Path: ../utils/catch404.ts
export const catch404 = async (reason: any) => {
  if (reason.statusCode !== 404) {
    return Promise.reject(reason);
  }
  return Promise.resolve(undefined);
}

export function getDocsFromNanoFetchRes<T>(response: nano.DocumentFetchResponse<T>): Array<T & Document> {
  if (!response) {
    throw new Error('Document not found');
  }

  for (const row of response.rows) {
    if (row.error) {
      throw new Error(row.error);
    }
  }

  const rows = response.rows.filter((row) => !row.error) as DocumentResponseRow<T>[];
  return rows.map((row) => row.doc).filter((doc) => doc !== undefined) as (T & Document)[];
}

export function removeCouchDBDetails<T extends Object>(x: T): T & CouchDBDetailsExcluded {
  return { ...x, _id: undefined, _rev: undefined, _deleted: undefined }
}
