import {
  QueueDoc,
  type ErrorResponse,
  type FetchMetadataDirectlyPayload,
  type NumberType,
  type iFetchMetadataDirectlySuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { getFromDB, mustGetFromDB } from '../db/db';
import { FetchModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { fetchUriFromSourceAndUpdateDb } from '../queue';

export const fetchMetadataDirectly = async (req: Request, res: Response<iFetchMetadataDirectlySuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as FetchMetadataDirectlyPayload;
    const uris = reqPayload.uris;

    if (uris.length > 100) {
      throw new Error('You can only fetch up to 100 metadata at a time.');
    }

    const status = await getStatus();
    const promises = [];
    for (const uri of uris) {
      promises.push(async () => {
        let metadataRes: any;
        const fetchDoc = await getFromDB(FetchModel, uri);

        if (!fetchDoc) {
          await fetchUriFromSourceAndUpdateDb(
            uri,
            new QueueDoc({
              _docId: crypto.randomBytes(32).toString('hex'),
              uri,
              collectionId: 0n,
              loadBalanceId: 0n,
              refreshRequestTime: 1n,
              numRetries: 0n,
              lastFetchedAt: 0n
            }),
            status.block.height
          );

          const newFetchDoc = await mustGetFromDB(FetchModel, uri);
          metadataRes = newFetchDoc?.content;
        } else {
          metadataRes = fetchDoc.content;
        }

        return metadataRes;
      });
    }

    const results = await Promise.all(promises.map(async (p) => await p()));

    return res.status(200).send({ metadata: results });
  } catch (e) {
    return res.status(500).send({ errorMessage: e.message });
  }
};
