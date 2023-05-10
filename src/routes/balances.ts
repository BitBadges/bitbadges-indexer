import { Request, Response } from "express";
import { BALANCES_DB } from "../db/db";

export const getBadgeBalance = async (req: Request, res: Response) => {
  try {
    const accountNumIdx = `${Number(req.params.accountNum)}`;
    const docId = `${req.params.id}:${accountNumIdx}`

    const response = await BALANCES_DB.partitionedFind(req.params.id, {
      selector: {
        _id: docId
      }
    });

    return res.status(200).send({
      balance: response.docs[0] ? response.docs[0] : { collectionId: Number(req.params.id), accountNumber: Number(req.params.accountNum), balances: [], approvals: [] }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Error fetching balances' });
  }
}