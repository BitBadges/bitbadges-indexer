import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { COLLECTIONS_DB, PASSWORDS_DB } from "../db/db";

export const getCodes = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest

    const collectionId = Number(req.params.id);

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
      limit: 1000000, //TODO: make this a list _all_doc or partitionedList query (for now, we just assume less than 1000000 claims)
    }

    const codesDocsArr = await PASSWORDS_DB.find(docQuery);
    const docs = codesDocsArr.docs.sort((a, b) => a.claimId - b.claimId).filter(doc => doc.docClaimedByCollection);

    for (const doc of docs) {
      codes.push(doc.codes);
      passwords.push(doc.password);
    }

    return res.status(200).send({ codes, passwords });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ message: 'Internal server error' });
  }
}