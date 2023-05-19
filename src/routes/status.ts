import { convertFromDbStatus } from "bitbadgesjs-utils";
import { getStatus } from "../db/status";

import { Request, Response } from "express";

export const getStatusHandler = async (req: Request, res: Response) => {
  try {
    const status = await getStatus();
    return res.json({ status: convertFromDbStatus(status) });
  } catch (e) {
    return res.status(500).send({ error: e });
  }
};
