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
  getAuthDetails,
  setMockSessionIfTestMode
} from '../blockin/blockin_handlers';
import { getStatus } from '../db/status';
import { insertToDB } from '../db/db';
import { ClaimAlertModel } from '../db/schemas';
import { findInDB } from '../db/queries';
import crypto from 'crypto';
import typia from 'typia';
import { typiaError } from './search';

export const sendClaimAlert = async (req: MaybeAuthenticatedRequest<NumberType>, res: Response<iSendClaimAlertsSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as SendClaimAlertsPayload;
    setMockSessionIfTestMode(req);

    const validateRes: typia.IValidation<SendClaimAlertsPayload> = typia.validate<SendClaimAlertsPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    for (const claimAlert of reqPayload.claimAlerts) {
      if (claimAlert.collectionId && Number(claimAlert.collectionId) !== 0) {
        const isManager = await checkIfManager(req, res, claimAlert.collectionId);
        if (!isManager) {
          return res.status(401).send({
            errorMessage: 'You must be the manager of the collection you are trying to send claim alerts for.'
          });
        }
      }

      const authDetails = await getAuthDetails(req, res);
      if (authDetails?.cosmosAddress) {
        const authenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Send Claim Alerts' }]);
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
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
    const validateRes: typia.IValidation<GetClaimAlertsForCollectionPayload> = typia.validate<GetClaimAlertsForCollectionPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const collectionId = Number(reqPayload.collectionId);

    const isManager = await checkIfManager(req, res, collectionId);
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error getting claim alerts.'
    });
  }
}
