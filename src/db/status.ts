import { StatusDoc } from "bitbadgesjs-utils";
import { StatusModel, insertToDB, mustGetFromDB } from "./db";
import mongoose from "mongoose";

export async function setStatus(status: StatusDoc<bigint>, session?: mongoose.mongo.ClientSession) {
  try {
    await insertToDB(StatusModel, status, session);
  } catch (error) {
    throw `Error in setStatus(): ${error}`;
  }
}

export async function getStatus() {
  try {
    const status = await mustGetFromDB(StatusModel, "status");

    return status;
  } catch (error) {
    throw new Error(`Error in getStatus(): ${error}`);
  }
}