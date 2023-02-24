import { Request, Response } from "express";
import { ACCOUNTS_DB, COLLECTIONS_DB } from "../db/db";

export const getBatchUsers = async (req: Request, res: Response) => {
    let accountNumsResponse;
    let addressesResponse;
    if (req.body.accountNums && req.body.accountNums.length !== 0) {
        const response = await ACCOUNTS_DB.fetch({ keys: req.body.accountNums.map((num: number) => `${num}`) });
        accountNumsResponse = response.rows.map((row: any) => row.doc);
    } else {
        accountNumsResponse = [];
    }

    if (req.body.addresses && req.body.addresses.length !== 0) {
        const response = await ACCOUNTS_DB.find(
            {
                selector: {
                    $or: [
                        {
                            address: {
                                $in: req.body.addresses
                            }
                        },
                        {
                            cosmosAddress: {
                                $in: req.body.addresses
                            }
                        }
                    ]
                }
            }
        );
        addressesResponse = response.docs;
    } else {
        addressesResponse = [];
    }


    return res.status(200).send({ accounts: [...accountNumsResponse, ...addressesResponse] });
}

export const getPortfolioInfo = async (req: Request, res: Response) => {
    // let accountInfo = await client.badgesQueryClient?.badges.getAccountInfoByNumber(Number(req.params.accountNum));

    const accountNumIdx = `${Number(req.params.accountNum)}`;
    // const balanceField = `balances.${accountNumIdx}`;

    const q: any = {};
    q.selector = {
        balances: {}
    }
    q.selector.balances[accountNumIdx] = {
        "balances": {
            "$gt": null
        }
    }

    const response = await COLLECTIONS_DB.find(q);

    const managingQuery: any = {};
    managingQuery.selector = {
        manager: {
            "$eq": Number(req.params.accountNum)
        }
    }

    const managingResponse = await COLLECTIONS_DB.find(q);


    return res.status(200).send({
        collected: response.docs,
        managing: managingResponse.docs,
    });
}