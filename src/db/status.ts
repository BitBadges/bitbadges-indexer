import { STATUS_DB } from "./db";
import { getDoc } from "./helpers";

export async function setStatus(status: any) {
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
        const status = await getDoc(STATUS_DB, 'status');
        return status;
    } catch (error) {
        throw `Error in getStatus(): ${error}`;
    }
}