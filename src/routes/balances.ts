import { Request, Response } from "express";
import { COLLECTIONS_DB } from "../db/db";

export const getBadgeBalance = async (req: Request, res: Response) => {
    const accountNumIdx = `${Number(req.params.accountNum)}`;
    const balanceField = `balances.${accountNumIdx}`;

    const q: any = {};
    q.selector = {
        _id: req.params.collectionId,
        balances: {}
    }
    q.selector.balances[accountNumIdx] = {
        "balances": {
            "$gt": null
        }
    }
    q.fields = [balanceField];


    const response = await COLLECTIONS_DB.find(q);

    return res.status(200).send({
        balance: response.docs[0]?.balances[accountNumIdx]
    });
}