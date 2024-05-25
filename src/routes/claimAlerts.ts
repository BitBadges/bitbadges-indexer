import {
  ClaimAlertDoc,
  type ErrorResponse,
  convertToCosmosAddress,
  type iGetClaimAlertsForCollectionSuccessResponse,
  type iSendClaimAlertsSuccessResponse,
  type GetClaimAlertsForCollectionPayload,
  type NumberType,
  type SendClaimAlertsPayload
} from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import {
  checkIfManager,
  type AuthenticatedRequest,
  MaybeAuthenticatedRequest,
  checkIfAuthenticated,
  getAuthDetails
} from '../blockin/blockin_handlers';
import { getStatus } from '../db/status';
import { insertToDB } from '../db/db';
import { ClaimAlertModel } from '../db/schemas';
import { findInDB } from '../db/queries';
import crypto from 'crypto';

export const sendClaimAlert = async (req: MaybeAuthenticatedRequest<NumberType>, res: Response<iSendClaimAlertsSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as SendClaimAlertsPayload;

    for (const claimAlert of reqPayload.claimAlerts) {
      if (claimAlert.collectionId && Number(claimAlert.collectionId) !== 0) {
        const isManager = await checkIfManager(req, claimAlert.collectionId);
        if (!isManager) {
          return res.status(401).send({
            errorMessage: 'You must be a manager of the collection you are trying to send claim alerts for.'
          });
        }
      }

      const authDetails = await getAuthDetails(req);
      if (authDetails?.cosmosAddress) {
        const authenticated = await checkIfAuthenticated(req, ['Send Claim Alerts']);
        if (!authenticated) {
          return res.status(401).send({
            errorMessage: 'To send claim alerts from ' + authDetails?.cosmosAddress + ', you must be authenticated with the Send Claim Alerts scope.'
          });
        }
      }

      if (!claimAlert.message || claimAlert.message.length > 1000) {
        return res.status(400).send({
          errorMessage: 'Claim alert message must be between 1 and 1000 characters.'
        });
      }

      const id = crypto.randomBytes(32).toString('hex');
      const status = await getStatus();
      const doc = new ClaimAlertDoc<NumberType>({
        from: authDetails?.cosmosAddress || '',
        _docId: `${claimAlert.collectionId}:${id}`,
        timestamp: Number(Date.now()),
        collectionId: Number(claimAlert.collectionId),
        message: claimAlert.message,
        cosmosAddresses: claimAlert.cosmosAddresses.map(convertToCosmosAddress),
        block: status.block.height
      });

      await insertToDB(ClaimAlertModel, doc);
    }

    return res.status(200).send({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error adding claim alert.'
    });
  }
};

export async function getClaimAlertsForCollection(
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimAlertsForCollectionSuccessResponse<NumberType> | ErrorResponse>
) {
  try {
    const reqPayload = req.body as unknown as GetClaimAlertsForCollectionPayload;

    const collectionId = Number(reqPayload.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) {
      return res.status(401).send({
        errorMessage: 'You must be the manager of the collection you are trying to get claim alerts for.'
      });
    }

    const claimAlerts = await findInDB(ClaimAlertModel, {
      query: { collectionId },
      limit: 25,
      skip: reqPayload.bookmark ? 25 * Number(reqPayload.bookmark) : 0
    });
    const pagination = {
      bookmark: (reqPayload.bookmark ? Number(reqPayload.bookmark) + 1 : 1).toString(),
      hasMore: claimAlerts.length === 25
    };

    return res.status(200).send({ claimAlerts, pagination });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error getting claim alerts.'
    });
  }
}
