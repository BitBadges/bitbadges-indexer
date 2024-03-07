import {
  ClaimAlertDoc,
  type ErrorResponse,
  convertToCosmosAddress,
  type iGetClaimAlertsForCollectionRouteSuccessResponse,
  type iSendClaimAlertsRouteSuccessResponse,
  type GetClaimAlertsForCollectionRouteRequestBody,
  type NumberType,
  type SendClaimAlertsRouteRequestBody
} from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfManager, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getStatus } from '../db/status';
import { insertToDB } from '../db/db';
import { ClaimAlertModel } from '../db/schemas';
import { findInDB } from '../db/queries';

export const sendClaimAlert = async (req: AuthenticatedRequest<NumberType>, res: Response<iSendClaimAlertsRouteSuccessResponse | ErrorResponse>) => {
  try {
    const reqBody = req.body as SendClaimAlertsRouteRequestBody;

    for (const claimAlert of reqBody.claimAlerts) {
      const isManager = await checkIfManager(req, claimAlert.collectionId);
      if (!isManager) {
        return res.status(403).send({
          errorMessage: 'You must be a manager of the collection you are trying to send claim alerts for.'
        });
      }

      // random collision resistant id (ik it's not properly collision resistant but we just need it to not collide)
      const id = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      const status = await getStatus();
      const doc = new ClaimAlertDoc<NumberType>({
        _docId: `${claimAlert.collectionId}:${id}`,
        timestamp: Number(Date.now()),
        collectionId: Number(claimAlert.collectionId),
        message: claimAlert.message,
        cosmosAddresses: [convertToCosmosAddress(claimAlert.recipientAddress)],
        block: status.block.height
      });

      await insertToDB(ClaimAlertModel, doc);
    }

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding claim alert. Please try again later.'
    });
  }
};

export async function getClaimAlertsForCollection(
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimAlertsForCollectionRouteSuccessResponse<NumberType> | ErrorResponse>
) {
  try {
    const reqBody = req.body as GetClaimAlertsForCollectionRouteRequestBody;

    const collectionId = Number(reqBody.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) {
      return res.status(403).send({
        errorMessage: 'You must be the manager of the collection you are trying to get claim alerts for.'
      });
    }

    const claimAlerts = await findInDB(ClaimAlertModel, {
      query: { collectionId },
      limit: 25,
      skip: reqBody.bookmark ? 25 * Number(reqBody.bookmark) : 0
    });
    const pagination = {
      bookmark: (reqBody.bookmark ? Number(reqBody.bookmark) + 1 : 1).toString(),
      hasMore: claimAlerts.length === 25
    };

    return res.status(200).send({ claimAlerts, pagination });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting claim alerts. Please try again later.'
    });
  }
}
