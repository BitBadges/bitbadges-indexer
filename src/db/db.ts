import { config } from "dotenv";
import { getDocAndReturnTemplateIfEmpty } from "./helpers";

config();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const nano = require('nano')(`${process.env.DB_URL}`);
export const ACCOUNTS_DB = nano.db.use('accounts');
export const COLLECTIONS_DB = nano.db.use('collections');
export const STATUS_DB = nano.db.use('status');
export const ERRORS_DB = nano.db.use('errors');
export const METADATA_DB = nano.db.use('metadata'); //partitioned

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
    metadata: any;
}

export async function fetchDocsForRequestIfEmpty(currDocs: Docs, accountNums: number[], collectionIds: number[], metadataIds: string[]) {
    try {
        const newCollectionIds = collectionIds.filter((id) => !currDocs.collections[id]);
        const newAccountNums = accountNums.filter((id) => !currDocs.accounts[id]);
        const newMetadataIds = metadataIds.filter((id) => !currDocs.metadata[id]);

        if (newCollectionIds.length || newAccountNums.length || newMetadataIds.length) {
            const newDocs = await fetchDocsForRequest(newAccountNums, newCollectionIds, newMetadataIds);
            
            return {
                accounts: {
                    ...currDocs.accounts,
                    ...newDocs.accounts
                },
                collections: {
                    ...currDocs.collections,
                    ...newDocs.collections
                },
                metadata: {
                    ...currDocs.metadata,
                    ...newDocs.metadata
                }
            };
        } else {
            return currDocs;
        }
    } catch (error) {
        throw `Error in fetchDocsForRequestIfEmpty(): ${error}`;
    }
}


export async function fetchDocsForRequest(_accountNums: number[], _collectionIds: number[], _metadataIds: string[]) {
    try {
        const collectionIds = [...new Set(_collectionIds)];
        const accountNums = [...new Set(_accountNums)];
        const metadataIds = [...new Set(_metadataIds)];



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
        const metadataData: any = {};



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

        if (metadataIds.length) {
            for (const metadataId of metadataIds) {
                metadataData[metadataId] = await getDocAndReturnTemplateIfEmpty(METADATA_DB, metadataId);
            }
        }

        return { accounts: accountData, collections: collectionData, metadata: metadataData };
    } catch (error) {
        throw `Error in fetchDocsForRequest(): ${error}`;
    }
}

export async function finalizeDocsForRequest(userData: any, collectionData: any, metadataData: any) {
    try {
        await Promise.all(
            [
                ACCOUNTS_DB.bulk({ docs: Object.values(userData) }),
                COLLECTIONS_DB.bulk({ docs: Object.values(collectionData) }),
                METADATA_DB.bulk({ docs: Object.values(metadataData) }),
            ]
        );
    } catch (error) {
        throw `Error in finalizeDocsForRequest(): ${error}`;
    }
}
