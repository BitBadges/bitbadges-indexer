import { GetStatusRouteResponse, NumberType, StatusDoc, convertStatusDoc } from "bitbadgesjs-utils";
import { getStatus } from "../db/status";

import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { Stringify } from "bitbadgesjs-proto";


export const getStatusHandler = async (req: Request, res: Response<GetStatusRouteResponse<NumberType>>) => {
  try {
    const status = await getStatus();
    const statusToReturn = convertStatusDoc(status, Stringify) as StatusDoc<string>;
    return res.json({ status: statusToReturn });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "We encountered an error communicating with the database. We could not get its status."
    });
  }
};
