import { config } from "dotenv";
import { getDocAndReturnTemplateIfEmpty } from "./helpers";

config();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nano = require('nano')(`${process.env.DB_URL}`);
export const ACCOUNTS_DB = nano.db.use('accounts');
export const COLLECTIONS_DB = nano.db.use('collections');
export const STATUS_DB = nano.db.use('status');

/**
 * Default blanks templates for empty or newly created DB documents.
 *
 * Currently only supports 'users' because badges can't be blank and don't have a default.
 */
export const blankTemplates = {

};

export interface Docs {
    accounts: any;
    collections: any;
}


export async function fetchDocsForRequest(_accountNums: number[], _collectionIds: number[]) {
    try {
        const collectionIds = [...new Set(_collectionIds)];
        const accountNums = [...new Set(_accountNums)];



        //TODO: validation of accountNums and collectionIds (positive number)

        // const invalidAccountNum = userIds.find((id) => {
        //     const { chain, address } = parseId(id);

        //     const isValidAddress = getChain(chain).validateAddress(address);
        //     return !isValidAddress;
        // });

        // if (invalidUserAddress) {
        //     throw `${invalidUserAddress} is not a valid address.`;
        // }

        const accountData: any = {};
        const collectionData: any = {};



        if (collectionIds.length) {
            for (const collectionId of collectionIds) {
                collectionData[collectionId] = await getDocAndReturnTemplateIfEmpty(COLLECTIONS_DB, collectionId.toString(10));
            }
        }

        if (accountNums.length) {
            for (const accountNum of accountNums) {
                accountData[accountNum] = await getDocAndReturnTemplateIfEmpty(ACCOUNTS_DB, accountNum.toString(10));
            }
        }

        return { accounts: accountData, collections: collectionData };
    } catch (error) {
        throw `Error in fetchDocsForRequest(): ${error}`;
    }
}

export async function finalizeDocsForRequest(userData: any, collectionData: any) {
    try {
        await Promise.all(
            [
                ACCOUNTS_DB.bulk({ docs: Object.values(userData) }),
                COLLECTIONS_DB.bulk({ docs: Object.values(collectionData) }),
            ]
        );
    } catch (error) {
        throw `Error in finalizeDocsForRequest(): ${error}`;
    }
}
