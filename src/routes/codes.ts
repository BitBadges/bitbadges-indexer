import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { COLLECTIONS_DB, PASSWORDS_DB } from "../db/db";
import { convertToPasswordDocument } from "bitbadgesjs-utils";
import { AES } from "crypto-js";

export const getCodes = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    const collectionId = BigInt(req.params.id);

    const collection = await COLLECTIONS_DB.get(`${collectionId}`);
    const manager = collection.manager;
    if (req.session.cosmosAddress && manager !== req.session.cosmosAddress) {
      return res.status(401).send({ error: 'Unauthorized. Must be manager of this collection.' });
    }

    const codes: string[][] = [];
    const passwords: string[] = [];
    const docQuery: nano.MangoQuery = {
      selector: {
        collectionId: {
          "$eq": collectionId
        }
      },
      limit: 0, // no limit
    }

    const _codesDocsArr = await PASSWORDS_DB.find(docQuery);
    const codesDocsArr = _codesDocsArr.docs.map(doc => convertToPasswordDocument(doc));

    const docs = codesDocsArr.sort((a, b) => {
      const diff = a.claimId - b.claimId;
      const diffNumber = Number(diff.toString());
      return diffNumber;
    }).filter(doc => doc.docClaimedByCollection);

    for (const doc of docs) {
      codes.push(doc.codes.map(code => AES.decrypt(code, process.env.SYM_KEY).toString()));
      passwords.push(AES.decrypt(doc.password, process.env.SYM_KEY).toString());
    }

    return res.status(200).send({ codes, passwords });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ message: 'Internal server error' });
  }
}