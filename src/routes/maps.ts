import {
  GetMapValuesPayload,
  UintRangeArray,
  ValueStore,
  iGetMapValuesSuccessResponse,
  type ErrorResponse,
  type GetMapsPayload,
  type NumberType,
  type iGetMapsSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import { getFromDB, mustGetManyFromDB } from '../db/db';
import { FetchModel, MapModel } from '../db/schemas';
import { fetchUriFromSource } from '../queue';
import { typiaError } from './search';

export const getMaps = async (req: Request, res: Response<iGetMapsSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetMapsPayload;
    const validateRes: typia.IValidation<GetMapsPayload> = typia.validate<GetMapsPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const mapIds = reqPayload.mapIds;
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting maps'
    });
  }
};

export const getMapValues = async (req: Request, res: Response<iGetMapValuesSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetMapValuesPayload;
    const validateRes: typia.IValidation<GetMapValuesPayload> = typia.validate<GetMapValuesPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const values = reqPayload.valuesToFetch;
    let totalVals = 0;
    for (const request of values) {
      totalVals += request.keys.length;
    }

    if (totalVals > 100) {
      throw new Error('Cannot fetch more than 100 values at a time.');
    }
    const results: { mapId: string; values: { [key: string]: ValueStore } }[] = [];

    for (const request of values) {
      const map = await getFromDB(MapModel, request.mapId);
      if (!map) {
        throw new Error('Map not found');
      }

      const mapValues: { [key: string]: ValueStore } = {};
      for (const key of request.keys) {
        const value = map.values[key];
        if (value) {
          mapValues[key] = value;
        }
      }

      results.push({
        mapId: request.mapId,
        values: mapValues
      });
    }

    return res.status(200).send({
      values: results
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting map values'
    });
  }
};
