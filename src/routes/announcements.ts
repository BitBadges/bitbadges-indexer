import { AddAnnouncementRouteRequestBody, AddAnnouncementRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager, returnUnauthorized } from "../blockin/blockin_handlers";
import { ANNOUNCEMENTS_DB, insertToDB } from "../db/db";
import { getStatus } from "../db/status";

export const addAnnouncement = async (expressReq: Request, res: Response<AddAnnouncementRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest;
    const reqBody = req.body as AddAnnouncementRouteRequestBody;
    const collectionId = BigInt(req.params.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) return returnUnauthorized(res, true);

    if (!reqBody.announcement || reqBody.announcement.length > 2048) {
      return res.status(400).send({ message: 'Announcement must be 1 to 2048 characters long.' });
    }

    const status = await getStatus();

    //random collision resistant id (ik it's not properly collision resistant but we just need it to not collide)
    const id = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    const activityDoc = {
      _id: `collection-${collectionId}:${id}`,
      method: 'Announcement',
      collectionId: collectionId,
      announcement: reqBody.announcement,
      from: req.session.cosmosAddress,
      timestamp: BigInt(Date.now()),
      block: BigInt(status.block.height)
    }

    await insertToDB(ANNOUNCEMENTS_DB, activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding announcement. Please try again later."
    })
  }
}
