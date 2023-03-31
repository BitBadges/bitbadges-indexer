import { config } from "dotenv";
import Nano from "nano";
import { AccountDocument, DbStatus, MetadataDocument, PasswordDocument, BadgeCollection, AccountDocs, CollectionDocs, Docs, MetadataDocs } from 'bitbadges-sdk';

config();

const nano = Nano(`${process.env.DB_URL}`);


export const ACCOUNTS_DB = nano.db.use<AccountDocument>('accounts');
export const COLLECTIONS_DB = nano.db.use<BadgeCollection>('collections');
export const STATUS_DB = nano.db.use<DbStatus>('status');
export const ERRORS_DB = nano.db.use<any>('errors');
export const METADATA_DB = nano.db.use<MetadataDocument>('metadata'); //partitioned
export const PASSWORDS_DB = nano.db.use<PasswordDocument>('passwords');

export async function fetchDocsForRequestIfEmpty(currDocs: Docs, accountNums: number[], collectionIds: number[], metadataIds: string[]) {
    try {
        const newCollectionIds = collectionIds.filter((id) => !currDocs.collections[id]);
        const newAccountNums = accountNums.filter((id) => !currDocs.accounts[id]);
        const newMetadataIds = metadataIds.filter((id) => !currDocs.metadata[id]);

        if (newCollectionIds.length || newAccountNums.length || newMetadataIds.length) {
            const newDocs = await fetchDocsForRequest(newAccountNums, newCollectionIds, newMetadataIds);
            const newAccounts = {
                ...currDocs.accounts,
                ...newDocs.accounts
            }

            const accountNumbersMap = {};
            for (const account of Object.values(newAccounts)) {
                accountNumbersMap[account.cosmosAddress] = account.account_number;
            }

            return {
                accounts: newAccounts,
                collections: {
                    ...currDocs.collections,
                    ...newDocs.collections
                },
                metadata: {
                    ...currDocs.metadata,
                    ...newDocs.metadata
                },
                accountNumbersMap
            };
        } else {
            return currDocs;
        }
    } catch (error) {
        throw `Error in fetchDocsForRequestIfEmpty(): ${error}`;
    }
}

//Fetch docs at start of handling block(s)
export async function fetchDocsForRequest(_accountNums: number[], _collectionIds: number[], _metadataIds: string[]) {
    try {
        const collectionIds = [...new Set(_collectionIds)].filter((id) => id >= 0);
        const accountNums = [...new Set(_accountNums)].filter((id) => id >= 0);
        const metadataIds = [...new Set(_metadataIds)].filter((id) => id.length > 0);

        const accountData: AccountDocs = {};
        const collectionData: CollectionDocs = {};
        const metadataData: MetadataDocs = {};

        const promises = [];

        for (const collectionId of collectionIds) {
            promises.push(COLLECTIONS_DB.get(collectionId.toString(10)));
        }

        for (const accountNum of accountNums) {
            promises.push(ACCOUNTS_DB.get(accountNum.toString(10)));
        }

        for (const metadataId of metadataIds) {
            promises.push(METADATA_DB.get(metadataId));
        }

        const results = await Promise.allSettled(promises);

        let idx = 0;
        for (const collectionId of collectionIds) {
            const result = results[idx++];
            if (result.status === 'fulfilled') {
                collectionData[collectionId] = result.value as Nano.DocumentGetResponse & BadgeCollection;
            } else {
                collectionData[collectionId] = {
                    _id: collectionId.toString(10)
                } as Nano.DocumentGetResponse & BadgeCollection;
            }
        }

        for (const accountNum of accountNums) {
            const result = results[idx++];
            if (result.status === 'fulfilled') {
                accountData[accountNum] = result.value as Nano.DocumentGetResponse & AccountDocument;
            } else {
                accountData[accountNum] = {
                    _id: accountNum.toString(10)
                } as Nano.DocumentGetResponse & AccountDocument;
            }
        }

        for (const metadataId of metadataIds) {
            const result = results[idx++];
            if (result.status === 'fulfilled') {
                metadataData[metadataId] = result.value as Nano.DocumentGetResponse & MetadataDocument;
            } else {
                metadataData[metadataId] = {
                    _id: metadataId
                } as Nano.DocumentGetResponse & MetadataDocument;
            }
        }

        return { accounts: accountData, collections: collectionData, metadata: metadataData };
    } catch (error) {
        throw `Error in fetchDocsForRequest(): ${error}`;
    }
}

//Finalize docs at end of handling block(s)
export async function finalizeDocsForRequest(docs: Docs) {
    try {
        await Promise.all(
            [
                ACCOUNTS_DB.bulk({ docs: Object.values(docs.accounts) }),
                COLLECTIONS_DB.bulk({ docs: Object.values(docs.collections) }),
                METADATA_DB.bulk({ docs: Object.values(docs.metadata) }),
            ]
        );
    } catch (error) {
        throw `Error in finalizeDocsForRequest(): ${error}`;
    }
}
