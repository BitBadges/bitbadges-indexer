import { Request, Response } from "express";
import { COLLECTIONS_DB } from "../db/db";
import nano from "nano";

export const getBadgeBalance = async (req: Request, res: Response) => {
    try {
        const accountNumIdx = `${Number(req.params.accountNum)}`;
        const balanceField = `balances.${accountNumIdx}`;

        const balanceQuery: nano.MangoQuery = {
            selector: {
                _id: req.params.id,
                balances: {
                    [accountNumIdx]: {
                        balances: {
                            "$gt": null
                        }
                    }
                }
            },
            fields: [balanceField]
        };

        const response = await COLLECTIONS_DB.find(balanceQuery);

        return res.status(200).send({
            balance: response.docs[0] && response.docs[0].balances[accountNumIdx] ? response.docs[0].balances[accountNumIdx] : { balances: [], approvals: [] }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}