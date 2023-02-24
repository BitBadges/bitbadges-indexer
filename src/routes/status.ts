import { DbStatus } from "src/types";
import { getStatus } from "../db/status";

import { Request, Response } from "express";

export const getStatusHandler = async (req: Request, res: Response) => {
    const status: DbStatus = await getStatus();
    return res.json({ status });
};
