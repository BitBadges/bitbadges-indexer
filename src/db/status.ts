import { StatusDoc } from "bitbadgesjs-utils";
import { STATUS_DB, insertToDB } from "./db";

export async function setStatus(status: StatusDoc<bigint>) {
  try {
    await insertToDB(STATUS_DB, status);
  } catch (error) {
    throw `Error in setStatus(): ${error}`;
  }
}

export async function getStatus() {
  try {
    const status = await STATUS_DB.get('status');
    return status;
  } catch (error) {
    throw `Error in getStatus(): ${error}`;
  }
}