import { JSPrimitiveNumberType, NumberType } from "bitbadgesjs-proto";
import { CodesAndPasswords, GetAllCodesAndPasswordsRouteResponse, PasswordDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager, returnUnauthorized } from "../blockin/blockin_handlers";
import { PASSWORDS_DB } from "../db/db";
import CryptoJS from "crypto-js";

const { AES } = CryptoJS;


export const getAllCodesAndPasswords = async (expressReq: Request, res: Response<GetAllCodesAndPasswordsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>; const collectionId = Number(req.params.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) return returnUnauthorized(res, true);

    const codesAndPasswords: CodesAndPasswords[] = [];
    const codesDocsArr: PasswordDoc<JSPrimitiveNumberType>[] = [];

    let docsLength = -1;
    let bookmark: string | undefined = undefined;
    do {
      const docQuery: nano.MangoQuery = {
        selector: {
          collectionId: {
            "$eq": collectionId
          }
        },
        bookmark,
        limit: 200,
      }

      const _codesDocsArr = await PASSWORDS_DB.find(docQuery);
      codesDocsArr.push(..._codesDocsArr.docs);
      docsLength = _codesDocsArr.docs.length;
      bookmark = docQuery.bookmark;
    } while (docsLength == 200);


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
      message: "Error getting codes. Please try again later."
    });
  }
}