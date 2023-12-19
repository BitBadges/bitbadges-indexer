import { GetApprovalsRouteRequestBody, GetApprovalsRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { ApprovalsTrackerModel, mustGetManyFromDB } from "../db/db";

export const getApprovals = async (req: Request, res: Response<GetApprovalsRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetApprovalsRouteRequestBody;
    let amountTrackerIds = reqBody.amountTrackerIds;
    if (amountTrackerIds.length > 100) {
      throw new Error("You can only fetch up to 100 approval trackers at a time.");
    }

    const docIds = [];

    for (const amountTrackerId of amountTrackerIds) {
      const docId = `${amountTrackerId.collectionId}:${amountTrackerId.approvalLevel}-${amountTrackerId.approverAddress}-${amountTrackerId.amountTrackerId}-${amountTrackerId.trackerType}-${amountTrackerId.approvedAddress}`;
      docIds.push(docId);
    }

    const docs = await mustGetManyFromDB(ApprovalsTrackerModel, docIds);
    return res.status(200).send({ approvalTrackers: docs });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
