import { GetMerkleChallengeTrackersRouteRequestBody, GetMerkleChallengeTrackersRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { MERKLE_CHALLENGES_DB } from "src/db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "src/utils/couchdb-utils";

export const getMerkleChallengeTrackers = async (req: Request, res: Response<GetMerkleChallengeTrackersRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetMerkleChallengeTrackersRouteRequestBody;
    let challengeIdDetails = reqBody.merkleChallengeTrackerIds;
    const docIds = [];

    for (const id of challengeIdDetails) {
      const docId = `${id.collectionId}:${id.challengeLevel}-${id.approverAddress}-${id.challengeId}`;
      docIds.push(docId);
    }


    const fetchRes = await MERKLE_CHALLENGES_DB.fetch({ keys: docIds });
    const docs = getDocsFromNanoFetchRes(fetchRes);


    return res.status(200).send({ merkleChallengeTrackers: [...docs.map(x => removeCouchDBDetails(x))] });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
