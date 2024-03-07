import { type CodesAndPasswords, type ErrorResponse, type NumberType, type iGetAllCodesAndPasswordsRouteSuccessResponse } from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { getPlugin, getPluginParamsAndState } from '../integrations/types';
import { checkIfManager, returnUnauthorized, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel } from '../db/schemas';
import { getDecryptedActionCodes } from './claims';

export const getAllCodesAndPasswords = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetAllCodesAndPasswordsRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const collectionId = Number(req.params.collectionId);
    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) return returnUnauthorized(res, true);

    const codesAndPasswords: CodesAndPasswords[] = [];
    const codesDocsArr = await findInDB(ClaimBuilderModel, {
      query: { collectionId, manualDistribution: true },
      limit: 200,
      skip: 0
    });

    if (codesDocsArr.length >= 200) {
      return res.status(500).send({
        error: 'Too many codes',
        errorMessage: 'Too many codes to fetch at once. Please try again later.'
      });
    }

    const docs = codesDocsArr.filter((doc) => doc.docClaimed);
    const symKey = process.env.SYM_KEY;
    if (!symKey) {
      return res.status(500).send({
        error: 'No symmetric key found',
        errorMessage: 'Error getting codes. Please try again later.'
      });
    }

    for (const doc of docs) {
      const codes = getDecryptedActionCodes(doc); //Action codes, not the private params
      const password = getPlugin('password').decryptPrivateParams(
        getPluginParamsAndState('password', doc.plugins)?.privateParams ?? { password: '' }
      ).password;

      codesAndPasswords.push({
        cid: doc.cid,
        codes: codes ?? [],
        password: password
      });
    }

    return res.status(200).send({ codesAndPasswords });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting codes. Please try again later.'
    });
  }
};
