
import { Request, Response } from "express";
import { ACCOUNTS_DB, METADATA_DB } from "../db/db";
import { convertToCosmosAddress, getChainForAddress, isAddressValid } from "../bitbadges-api/chains";
import { ethers } from "ethers";
import { appendNameForAccount } from "./users";

export const searchHandler = async (req: Request, res: Response) => {
    const searchValue = req.params.searchValue;
    if (!searchValue || searchValue.length == 0) {
        return res.json({
            collections: [],
            accounts: [],
        })
    }

    let address = searchValue;
    if (!isAddressValid(searchValue) && searchValue.includes('.eth')) {
        try {
            //Attempt to resolve name
            const provider = new ethers.InfuraProvider(
                'homestead',
                process.env.INFURA_API_KEY
            );
            const resolvedAddress = await provider.resolveName(address);
            if (resolvedAddress) {
                address = resolvedAddress;
            }
        } catch (e) {
            // console.log(e);
        }
    }

    //TODO: Error when regex is bad
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
                    { "address": { "$regex": `(?i)${address}` } },
                    { "cosmosAddress": { "$regex": `(?i)${address}` } },
                ]
            },
            limit: 3,
        }
    )

    if (isAddressValid(address) && !accountsResponse.docs.find((account: any) => account.address === address)) {
        accountsResponse.docs.push({
            accountNumber: -1,
            chain: getChainForAddress(address),
            address: address,
            cosmosAddress: convertToCosmosAddress(address),
            name: '',
        });
    }

    if (searchValue !== address) {
        for (const account of accountsResponse.docs) {
            account.name = searchValue;
        }
    }

    const accounts = [];
    for (let account of accountsResponse.docs) {
        if (!account.name) {
            account = await appendNameForAccount(account);
            account.chain = getChainForAddress(account.address);
        }

        accounts.push(account);
    }

    console.log(accounts);


    return res.json({
        collections: response.docs,
        accounts: accounts,
    })
}