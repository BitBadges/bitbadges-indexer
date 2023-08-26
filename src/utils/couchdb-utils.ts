//Catch function to return rejected promises upon non-404 errors but return undefined for all other errors

import { Identified } from "bitbadgesjs-utils";
import nano, { DocumentResponseRow, Document } from "nano";

// Path: ../utils/catch404.ts
export const catch404 = async (reason: any) => {
  if (reason.statusCode !== 404) {
    return Promise.reject(reason);
  }
  return Promise.resolve(undefined);
}

export function getDocsFromNanoFetchRes<T>(response: nano.DocumentFetchResponse<T>, doNotThrowOnNotFound?: boolean): Array<T & Document> {
  if (!response) {
    throw new Error('Document not found');
  }


  for (const row of response.rows) {
    if (row.error) {
      if (doNotThrowOnNotFound && row.error === 'not_found') {
        continue;
      }

      throw new Error(row.error);
    }
  }


  const rows = response.rows.filter((row) => !row.error) as DocumentResponseRow<T>[];
  return rows.map((row) => row.doc).filter((doc) => doc !== undefined) as (T & Document)[];
}

export function removeCouchDBDetails<T extends Object & { _id: string }>(x: T): T & Identified {
  return { ...x, _rev: undefined, _deleted: undefined }
}
