import { GetApprovalsRouteRequestBody, GetApprovalsRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { APPROVALS_TRACKER_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

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


    const fetchRes = await APPROVALS_TRACKER_DB.fetch({ keys: docIds });
    const docs = getDocsFromNanoFetchRes(fetchRes);


    return res.status(200).send({ approvalTrackers: [...docs.map(x => removeCouchDBDetails(x))] });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
