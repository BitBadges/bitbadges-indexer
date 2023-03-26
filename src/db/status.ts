import { DbStatus } from "../types";
import { STATUS_DB } from "./db";

export async function setStatus(status: DbStatus) {
    try {
        await Promise.all(
            [
                STATUS_DB.bulk({ docs: [status] }),
            ]
        );
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