
import { Request, Response } from "express";
import { ACCOUNTS_DB, METADATA_DB } from "../db/db";

export const searchHandler = async (req: Request, res: Response) => {
    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
        return res.json({
            collections: [],
            accounts: [],
        })
    }

    const response = await METADATA_DB.find(
        {
            selector: {
                "_id": { "$regex": `(?i)collection` },
                "$or": [
                    { "name": { "$regex": `(?i)${searchValue}` } },
                    { "_id": { "$regex": `(?i)${searchValue}:collection` } },
                ]
            },
            limit: 3,
        }
    )

    const accountsResponse = await ACCOUNTS_DB.find(
        {
            selector: {
                "$or": [
                    { "address": { "$regex": `(?i)${searchValue}` } },
                    { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
                ]
            },
            limit: 3,
        }
    )

    return res.json({
        collections: response.docs,
        accounts: accountsResponse.docs,
    })
}