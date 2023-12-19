
import { Request, Response } from "express";
import mongoose from "mongoose";
import { ReportDoc, ReportModel, insertToDB } from "../db/db";

export const addReport = async (req: Request, res: Response<{ message: string }>) => {
  try {
    const report = req.body;

    const reportDoc: ReportDoc = {
      _legacyId: new mongoose.Types.ObjectId().toString(),
      collectionId: report.collectionId,
      mappingId: report.mappingId,
      addressOrUsername: report.addressOrUsername,
      reason: report.reason,
    }
    await insertToDB(ReportModel, reportDoc);
    return res.status(200).send({ message: 'Report successfully submitted.' });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ message: e.message });
  }
}