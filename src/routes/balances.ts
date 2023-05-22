import { Request, Response } from "express";
import { BALANCES_DB } from "../db/db";

export const getBadgeBalance = async (req: Request, res: Response) => {
  try {
    const cosmosAddress = `${req.params.cosmosAddress.toString()}`;
    const docId = `${req.params.id}:${cosmosAddress}`

    const response = await BALANCES_DB.partitionedFind(req.params.id, {
      selector: {
        _id: docId
      },
      limit: 1
    });

    return res.status(200).send({
      balance: response.docs[0] ? response.docs[0] : { collectionId: BigInt(req.params.id).toString(), accountNumber: BigInt(req.params.accountNum).toString(), balances: [], approvals: [] }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Error fetching balances' });
  }
}