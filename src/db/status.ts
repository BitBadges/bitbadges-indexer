import { type StatusDoc } from 'bitbadgesjs-sdk';
import type mongoose from 'mongoose';
import { insertToDB, mustGetFromDB } from './db';
import { StatusModel } from './schemas';

export async function setStatus(status: StatusDoc<bigint>, session?: mongoose.mongo.ClientSession) {
  try {
    await insertToDB(StatusModel, status, session);
  } catch (error) {
    throw new Error(`Error in setStatus(): ${error}`);
  }
}

export async function getStatus() {
  try {
    const status = await mustGetFromDB(StatusModel, 'status');

    return status;
  } catch (error) {
    throw new Error(`Error in getStatus(): ${error}`);
  }
}
