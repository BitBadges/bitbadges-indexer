import { GetChallengeTrackersRouteRequestBody, GetChallengeTrackersRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { MerkleChallengeModel, mustGetManyFromDB } from "../db/db";

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


    const docs = await mustGetManyFromDB(MerkleChallengeModel, docIds);
    return res.status(200).send({ challengeTrackers: [...docs] });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
