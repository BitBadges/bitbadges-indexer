import { DbStatus } from "bitbadges-sdk";
import { getStatus } from "../db/status";

import { Request, Response } from "express";

export const getStatusHandler = async (req: Request, res: Response) => {
    try {
        const status: DbStatus = await getStatus();
        return res.json({ status });
    } catch (e) {
        return res.status(500).send({ error: e });
    }
};
