import { type EmptyResponseClass, type ErrorResponse } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { insertToDB } from '../db/db';
import { type ReportDoc } from '../db/docs';
import { ReportModel } from '../db/schemas';
import typia from 'typia';
import { typiaError } from './search';

export const addReport = async (req: Request, res: Response<EmptyResponseClass | ErrorResponse>) => {
  try {
    const report = req.body;
    const reportDoc: ReportDoc = {
      _docId: crypto.randomBytes(32).toString('hex'),
      collectionId: Number(report.collectionId),
      listId: report.listId,
      mapId: report.mapId,
      addressOrUsername: report.addressOrUsername,
      reason: report.reason
    };

    const validateRes: typia.IValidation<ReportDoc> = typia.validate<ReportDoc>(reportDoc);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    await insertToDB(ReportModel, reportDoc);
    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({ errorMessage: e.message });
  }
};
