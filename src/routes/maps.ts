import { type NumberType, UintRangeArray, type ErrorResponse, type GetMapsBody, type iGetMapsSuccessResponse } from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { fetchUriFromSource } from '../queue';
import { getFromDB, mustGetManyFromDB } from '../db/db';
import { FetchModel, MapModel } from '../db/schemas';

export const getMaps = async (req: Request, res: Response<iGetMapsSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetMapsBody;
    const mapIds = reqBody.mapIds;
    if (mapIds.length > 100) {
      throw new Error('Cannot fetch more than 100 maps at a time.');
    }

    const maps = await mustGetManyFromDB(MapModel, mapIds);

    let uris: string[] = [];
    for (const map of maps) {
      // Get metadata
      const uri = map.metadataTimeline.find((x) => UintRangeArray.From(x.timelineTimes).searchIfExists(BigInt(Date.now())))?.metadata.uri;
      if (uri) {
        uris.push(uri);
        uris = [...new Set(uris)];
      }
    }

    const promises = [];
    for (const uri of uris) {
      promises.push(async () => {
        let metadataRes: any;
        const fetchDoc = await getFromDB(FetchModel, uri);
        if (!fetchDoc) {
          metadataRes = await fetchUriFromSource(uri);
        } else {
          metadataRes = fetchDoc.content;
        }

        return metadataRes;
      });
    }

    const results = await Promise.all(promises.map(async (p) => await p()));
    return res.status(200).send({
      maps: maps.map((x) => {
        const matchingIdx = uris.findIndex((y) => y === x.metadataTimeline[0].metadata.uri);

        return {
          ...x,
          metadata: results[matchingIdx]
        };
      })
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting maps'
    });
  }
};
