import { JSPrimitiveNumberType, NumberType } from "bitbadgesjs-proto";
import { GetAllCodesAndPasswordsRouteResponse, PasswordDoc } from "bitbadgesjs-utils";
import { AES } from "crypto-js";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager, returnUnauthorized } from "../blockin/blockin_handlers";
import { PASSWORDS_DB } from "../db/db";

export const getAllCodesAndPasswords = async (expressReq: Request, res: Response<GetAllCodesAndPasswordsRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest
    const collectionId = Number(req.params.collectionId);

    const isManager = await checkIfManager(req, collectionId);
    if (!isManager) return returnUnauthorized(res, true);

    const codes: string[][][] = [];
    const passwords: string[][] = [];
    const codesDocsArr: PasswordDoc<JSPrimitiveNumberType>[] = [];

    let docsLength = -1;

    do {
      const docQuery: nano.MangoQuery = {
        selector: {
          collectionId: {
            "$eq": collectionId
          }
        },
        limit: 200,
      }

      const _codesDocsArr = await PASSWORDS_DB.find(docQuery);
      codesDocsArr.push(..._codesDocsArr.docs);
      docsLength = _codesDocsArr.docs.length;
    } while (docsLength !== 200);

    const docs = codesDocsArr.sort((a, b) => {
      const diff = BigInt(a.claimId) - BigInt(b.claimId);
      const diffNumber = Number(diff.toString());
      return diffNumber;
    }).filter(doc => doc.docClaimedByCollection);

    for (const doc of docs) {
      const currDocCodes = [];
      const currDocPasswords = [];

      for (const challengeDetails of doc.challengeDetails) {
        currDocCodes.push(challengeDetails.leavesDetails.preimages ?
          challengeDetails.leavesDetails.preimages.map(code => AES.decrypt(code, process.env.SYM_KEY).toString()) : []);
        currDocPasswords.push(challengeDetails.password ? AES.decrypt(challengeDetails.password ?? '', process.env.SYM_KEY).toString() : '');
      }

      codes.push(currDocCodes);
      passwords.push(currDocPasswords);
    }

    return res.status(200).send({ codes, passwords });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting codes. Please try again later."
    });
  }
}