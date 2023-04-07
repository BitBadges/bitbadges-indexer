
import { AccountResponse, convertToCosmosAddress, getChainForAddress, isAddressValid } from "bitbadges-sdk";
import { Request, Response } from "express";
import nano from "nano";
import { ACCOUNTS_DB, METADATA_DB } from "../db/db";
import { getAddressForName, getEnsDetails, getEnsResolver, getNameForAddress } from "../util/ensResolvers";
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
        let ensName = '';
        let ensDetails = {};
        let resolver = null;
        const tryEns = searchValue.includes('.eth') ? searchValue : `${searchValue}.eth`;
        if (!isAddressValid(searchValue)) {
            try {
                resolver = await getEnsResolver(tryEns)
                if (resolver?.name) {
                    address = await getAddressForName(resolver.name);
                    ensName = resolver.name;

                    //Attempt to get other details
                    const details = await getEnsDetails(resolver);
                    if (details) {
                        ensDetails = details;
                    }
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
                    { "address": { "$regex": `(?i)${searchValue}` } },
                    { "cosmosAddress": { "$regex": `(?i)${searchValue}` } },
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
                avatar: '',
                github: '',
                twitter: '',
                telegram: '',
                discord: '',
                sequence: 0,
                pub_key: '',
            });
        }

        //Update matching document with previously fetched ENS name
        if (ensName) {
            let idx = returnDocs.findIndex((doc) => doc.address === address);
            if (idx >= 0) {
                returnDocs[idx].name = tryEns;
                returnDocs[idx] = {
                    ...returnDocs[idx],
                    ...ensDetails,
                }
            }
        }

        //For all accounts, fetch the name and chain, then return it
        const accounts = [];
        const namePromises = [];

        for (const account of returnDocs) {
            if (!account.name) {
                namePromises.push(getNameForAddress(account.address));
                account.chain = getChainForAddress(account.address);
            } else {
                namePromises.push(Promise.resolve(account.name));
            }
        }

        const nameResults = await Promise.all(namePromises);
        const resolversPromises = [];
        for (let i = 0; i < returnDocs.length; i++) {
            const account = returnDocs[i];
            account.name = nameResults[i];
            account.chain = getChainForAddress(account.address);

            if (account.name) {
                resolversPromises.push(getEnsResolver(account.name));
            } else {
                resolversPromises.push(Promise.resolve(null));
            }
        }

        const resolversResults = await Promise.all(resolversPromises);
        const detailsPromises = [];
        for (let i = 0; i < returnDocs.length; i++) {
            const resolver = resolversResults[i];
            if (resolver) {
                detailsPromises.push(getEnsDetails(resolver));
            } else {
                detailsPromises.push(Promise.resolve({}));
            }
        }

        const detailsResults = await Promise.all(detailsPromises);
        for (let i = 0; i < returnDocs.length; i++) {
            let account = returnDocs[i];
            account = {
                ...account,
                ...detailsResults[i],
            }
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
