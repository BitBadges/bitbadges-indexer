import { GetChallengeTrackersRouteRequestBody, GetChallengeTrackersRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { MERKLE_CHALLENGES_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

export const getChallengeTrackers = async (req: Request, res: Response<GetChallengeTrackersRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetChallengeTrackersRouteRequestBody;
    let challengeIdDetails = reqBody.challengeTrackerIds;
    const docIds = [];

    if (challengeIdDetails.length > 100) {
      throw new Error("You can only fetch up to 100 challenge trackers at a time.");
    }

    for (const id of challengeIdDetails) {
      const docId = `${id.collectionId}:${id.challengeLevel}-${id.approverAddress}-${id.challengeId}`;
      docIds.push(docId);
    }


    const fetchRes = await MERKLE_CHALLENGES_DB.fetch({ keys: docIds }, { include_docs: true });
    const docs = getDocsFromNanoFetchRes(fetchRes);


    return res.status(200).send({ challengeTrackers: [...docs.map(x => removeCouchDBDetails(x))] });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
