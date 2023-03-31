
import { ethers } from "ethers";
import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, METADATA_DB } from "../db/db";
import { getNameForAddress } from "../util/ensResolvers";
import { isAddressValid, AccountResponse, getChainForAddress, convertToCosmosAddress } from "bitbadges-sdk";

export const searchHandler = async (req: Request, res: Response) => {
    try {
        const searchValue = req.params.searchValue;
        if (!searchValue || searchValue.length == 0) {
            return res.json({
                collections: [],
                accounts: [],
            })
        }

        //Attempt to resolve ENS
        let address = searchValue;
        let resolvedEnsAddress: string | undefined = undefined;
        const tryEns = searchValue.includes('.eth') ? searchValue : `${searchValue}.eth`;
        if (!isAddressValid(searchValue)) {
            try {
                //Attempt to resolve name
                const provider = new ethers.InfuraProvider(
                    'homestead',
                    process.env.INFURA_API_KEY
                );
                const resolvedAddress = await provider.resolveName(tryEns);
                if (resolvedAddress) {
                    resolvedEnsAddress = resolvedAddress;
                }
            } catch (e) {

            }
        }


        const searchQuery: nano.MangoQuery = {
            selector: {
                "isCollection": true,
                "$or": [
                    { "name": { "$regex": `(?i)${searchValue}` } },
                    { "_id": { "$regex": `(?i)${searchValue}:` } },
                ]
            },
            limit: 3,
        }

        const accountQuery = {
            selector: {
                "$or": [
                    { "address": { "$regex": `(?i)${address}` } },
                    { "cosmosAddress": { "$regex": `(?i)${address}` } },
                    { "address": { "$regex": `(?i)${resolvedEnsAddress}` } },
                    { "cosmosAddress": { "$regex": `(?i)${resolvedEnsAddress}` } },
                ]
            },
            limit: 3,
        }

        const results = await Promise.all([
            METADATA_DB.find(searchQuery),
            ACCOUNTS_DB.find(accountQuery),
        ]);

        const response = results[0];
        const accountsResponse = results[1];

        const returnDocs: (
            AccountResponse & {
                _id: string;
                _rev: string;
            }
        )[] = accountsResponse.docs.map((doc) => { return { ...doc, name: '' } });

        //If the address is valid, but not found in the database, add it to the return list (create fake return entry)
        if (isAddressValid(address) && !returnDocs.find((account: any) => account.address === address || account.cosmosAddress === address)) {
            returnDocs.push({
                _id: '-1',
                _rev: '',
                account_number: -1,
                chain: getChainForAddress(address),
                address: address,
                cosmosAddress: convertToCosmosAddress(address),
                name: '',
                sequence: 0,
                pub_key: '',
            });
        }

        //Update matching document with previously fetched ENS name
        if (resolvedEnsAddress) {
            const matchingDoc = returnDocs.find((doc) => doc.address === resolvedEnsAddress);
            if (matchingDoc) {
                matchingDoc.name = tryEns;
            }
        }

        //For all accounts, fetch the name and chain, then return it
        const accounts = [];
        const promises = [];

        for (let account of returnDocs) {
            if (!account.name) {
                promises.push(getNameForAddress(account.address));
                account.chain = getChainForAddress(account.address);
            } else {
                promises.push(Promise.resolve(account.name));
            }
        }


        const nameResults = await Promise.all(promises);
        for (let i = 0; i < returnDocs.length; i++) {
            const account = returnDocs[i];
            account.name = nameResults[i];
            accounts.push(account);
        }

        return res.json({
            collections: response.docs,
            accounts: accounts,
        })
    } catch (e) {
        console.error(e);
        return res.status(500).json({
            error: e,
        })
    }
}
