import { NumberType } from "bitbadgesjs-proto";
import { GetClaimAlertsForCollectionRouteRequestBody, GetClaimAlertsForCollectionRouteResponse, SendClaimAlertsRouteRequestBody, SendClaimAlertsRouteResponse, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager } from "../blockin/blockin_handlers";
import { ClaimAlertModel, insertToDB } from "../db/db";

export const sendClaimAlert = async (expressReq: Request, res: Response<SendClaimAlertsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>; const reqBody = req.body as SendClaimAlertsRouteRequestBody<NumberType>;

    for (const claimAlert of reqBody.claimAlerts) {
      const isManager = await checkIfManager(req, claimAlert.collectionId);
      if (!isManager) {
        return res.status(403).send({ message: 'You must be a manager of the collection you are trying to send claim alerts for.' });
      }

      //random collision resistant id (ik it's not properly collision resistant but we just need it to not collide)
      const id = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

      const doc = {
        _docId: `${claimAlert.collectionId}:${id}`,
        createdTimestamp: Number(Date.now()),
        collectionId: Number(claimAlert.collectionId),
        message: claimAlert.message,
        cosmosAddresses: [convertToCosmosAddress(claimAlert.recipientAddress)],
      }

      await insertToDB(ClaimAlertModel, doc);
    }

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding announcement. Please try again later."
    })
  }
}

export async function getClaimAlertsForCollection(expressReq: Request, res: Response<GetClaimAlertsForCollectionRouteResponse<NumberType>>) {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetClaimAlertsForCollectionRouteRequestBody<NumberType>;

    const collectionId = Number(reqBody.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) {
      return res.status(403).send({ message: 'You must be the manager of the collection you are trying to get claim alerts for.' });
    }

    const claimAlerts = await ClaimAlertModel.find({
      collectionId: collectionId
    }).lean().limit(25).skip(reqBody.bookmark ? 25 * Number(reqBody.bookmark) : 0).exec();

    const pagination = {
      bookmark: (reqBody.bookmark ? Number(reqBody.bookmark) + 1 : 1).toString(),
      hasMore: claimAlerts.length === 25,
    }

    return res.status(200).send({ claimAlerts, pagination });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting claim alerts. Please try again later."
    })
  }
}