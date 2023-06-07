import { AddAnnouncementRouteRequestBody, AddAnnouncementRouteResponse, AnnouncementInfoBase } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { AuthenticatedRequest, checkIfManager, returnUnauthorized } from "../blockin/blockin_handlers";
import { ANNOUNCEMENTS_DB, insertToDB } from "../db/db";
import { getStatus } from "../db/status";
import { serializeError } from "serialize-error";

export const addAnnouncement = async (expressReq: Request, res: Response<AddAnnouncementRouteResponse>) => {
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

    const activityDoc: AnnouncementInfoBase<bigint> & {
      partition: string
    } = {
      partition: `collection-${collectionId}`,
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
