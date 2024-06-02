import { type iGetStatusSuccessResponse, type ErrorResponse, type NumberType } from 'bitbadgesjs-sdk';
import { getStatus } from '../db/status';

import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';

export const getStatusHandler = async (req: Request, res: Response<iGetStatusSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const status = await getStatus();
    return res.json({ status });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Could not get DB status.'
    });
  }
};
