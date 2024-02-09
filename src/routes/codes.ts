import { JSPrimitiveNumberType, NumberType } from "bitbadgesjs-sdk";
import { CodesAndPasswords, GetAllCodesAndPasswordsRouteResponse, PasswordDoc } from "bitbadgesjs-sdk";
import CryptoJS from "crypto-js";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager, returnUnauthorized } from "../blockin/blockin_handlers";
import { PasswordModel } from "../db/db";

const { AES } = CryptoJS;


export const getAllCodesAndPasswords = async (expressReq: Request, res: Response<GetAllCodesAndPasswordsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const collectionId = Number(req.params.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) return returnUnauthorized(res, true);

    const codesAndPasswords: CodesAndPasswords[] = [];
    const codesDocsArr: PasswordDoc<JSPrimitiveNumberType>[] = [];

    do {
      const _codesDocsArr = await PasswordModel.find({
        collectionId: collectionId
      }).skip(codesDocsArr.length).limit(200).lean().exec();

      codesDocsArr.push(..._codesDocsArr as PasswordDoc<JSPrimitiveNumberType>[]);
    } while (codesDocsArr.length % 200 === 0);


    const docs = codesDocsArr.filter(doc => doc.docClaimedByCollection);

    for (const doc of docs) {
      const challengeDetails = doc.challengeDetails;
      codesAndPasswords.push({
        cid: doc.cid,
        codes: challengeDetails?.leavesDetails.preimages ?
          challengeDetails.leavesDetails.preimages.map(code => AES.decrypt(code, process.env.SYM_KEY).toString(CryptoJS.enc.Utf8)) : [],
        password: challengeDetails?.password ? AES.decrypt(challengeDetails.password ?? '', process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) : '',
      });
    }

    return res.status(200).send({ codesAndPasswords });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error getting codes. Please try again later."
    });
  }
}