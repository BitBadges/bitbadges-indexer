import { GetApprovalsRouteRequestBody, GetApprovalsRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { APPROVALS_TRACKER_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

export const getApprovals = async (req: Request, res: Response<GetApprovalsRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetApprovalsRouteRequestBody;
    let approvalTrackerIds = reqBody.approvalTrackerIds;
    const docIds = [];

    for (const approvalTrackerId of approvalTrackerIds) {
      const docId = `${approvalTrackerId.collectionId}:${approvalTrackerId.approvalLevel}-${approvalTrackerId.approverAddress}-${approvalTrackerId.approvalId}-${approvalTrackerId.trackerType}-${approvalTrackerId.approvedAddress}`;
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
