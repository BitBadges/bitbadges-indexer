import { type iGetStatusRouteSuccessResponse, type ErrorResponse, type NumberType } from 'bitbadgesjs-sdk';
import { getStatus } from '../db/status';

import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';

export const getStatusHandler = async (req: Request, res: Response<iGetStatusRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const status = await getStatus();
    return res.json({ status });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'We encountered an error communicating with the database. We could not get its status.'
    });
  }
};
