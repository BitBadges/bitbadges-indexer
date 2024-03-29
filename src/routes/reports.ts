import { type EmptyResponseClass, type ErrorResponse } from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { insertToDB } from '../db/db';
import { type ReportDoc } from '../db/docs';
import { ReportModel } from '../db/schemas';

export const addReport = async (req: Request, res: Response<EmptyResponseClass | ErrorResponse>) => {
  try {
    const report = req.body;

    const reportDoc: ReportDoc = {
      _docId: new mongoose.Types.ObjectId().toString(),
      collectionId: report.collectionId,
      listId: report.listId,
      addressOrUsername: report.addressOrUsername,
      reason: report.reason
    };
    await insertToDB(ReportModel, reportDoc);
    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({ errorMessage: e.message });
  }
};
