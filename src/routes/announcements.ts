import { AnnouncementActivityItem } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { ACTIVITY_DB, COLLECTIONS_DB } from "../db/db";
import { getStatus } from "../db/status";

export const addAnnouncement = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest
    if (!req.body.announcement || req.body.announcement.length > 2048) {
      return res.status(400).send({ error: 'Announcement must be 1 to 2048 characters long.' });
    }

    const collectionId = Number(req.params.id);
    const collection = await COLLECTIONS_DB.get(`${collectionId}`);
    const manager = collection.manager;
    if (req.session.accountNumber && manager !== req.session.accountNumber) {
      return res.status(401).send({ error: 'Unauthorized. Must be manager of this collection.' });
    }

    const status = await getStatus();

    const { announcement } = req.body;
    const activityDoc: AnnouncementActivityItem & {
      partition: string
    } = {
      partition: `collection-${collectionId}`,
      method: 'Announcement',
      collectionId,
      announcement,
      from: req.session.cosmosAddress,
      timestamp: Date.now(),
      block: status.block.height,
    }

    await ACTIVITY_DB.insert(activityDoc);

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: 'Error adding announcement. Please try again later.'
    })
  }
}
