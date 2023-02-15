import axios from "axios"
import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { Docs, fetchDocsForRequest, finalizeDocsForRequest } from "../db/db"
import { getAttributeValueByKey } from "../indexer"
import { IndexerStargateClient } from "../indexer_stargateclient"
import { getFromIpfs } from "../ipfs/getFromIpfs"
import { BadgeCollection, BadgeMetadata, DistributionMethod, IdRange, Transfers } from "../types"
import { AddBalancesForIdRanges } from "../util/balances-gpt"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { handleNewAccount } from "./handleNewAccount"


const fetchMetadata = async (uri: string): Promise<BadgeMetadata> => {
    if (uri.startsWith('ipfs://')) {
        const res = await getFromIpfs(uri.replace('ipfs://', ''));
        return JSON.parse(res.file);
    } else {
        const res = await axios.get(uri).then((res) => res.data);
        return res;
    }
}

const fetchBadgeMetadata = async (badgeIdsToFetch: IdRange, badgeUri: string): Promise<BadgeMetadata[]> => {
    //Create empty array for all unique badges if it does not exist on the current badge object
    //Get the individual badge metadata
    let badgeMetadata: BadgeMetadata[] = [];
    for (let i = badgeIdsToFetch.start; i < Number(badgeIdsToFetch.end); i++) {
        badgeMetadata.push({} as BadgeMetadata);
        badgeMetadata[i] = await fetchMetadata(badgeUri.replace('{id}', i.toString()));
    }

    return badgeMetadata;
}

export const fetchClaims = async (collection: BadgeCollection) => {
    //Handle claim objects
    for (let idx = 0; idx < collection.claims.length; idx++) {
        let claim = collection.claims[idx];

        if (Number(claim.type) === 0) {
            let res = await getFromIpfs(claim.uri.replace('ipfs://', ''));
            const fetchedLeaves: string[] = JSON.parse(res.file);

            if (fetchedLeaves[0]) {
                if (fetchedLeaves[0].split('-').length < 5 || (fetchedLeaves[0].split('-').length - 3) % 2 != 0) {
                    //Is a list of hashed codes; do not hash the leaves
                    //Users will enter their code and we check if we have a Merkle proof for it
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].distributionMethod = DistributionMethod.Codes;
                } else {
                    //Is a list of specific codes with addresses
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].distributionMethod = DistributionMethod.Whitelist;
                }
            }
        }
    }

    return collection.claims;
}

export const handleTransfers = async (collection: BadgeCollection, transfers: Transfers[]) => {
    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId]);

    for (let idx = 0; idx < transfers.length; idx++) {
        let transfer = transfers[idx];
        for (let j = 0; j < transfer.toAddresses.length; j++) {
            let address = transfer.toAddresses[j];

            let currBalance = docs.collections[collection.collectionId].balances[address]
                ? docs.collections[collection.collectionId].balances[address]
                : {
                    balances: [],
                    approvals: [],
                };

            for (const transferBalanceObj of transfer.balances) {
                docs.collections[collection.collectionId].balances[address] = AddBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.balance);

            }
        }
        docs.collections[collection.collectionId].activity.push({
            from: ['Mint'],
            to: transfer.toAddresses,
            balances: transfer.balances,
            method: 'Mint',
        });

    }
    await finalizeDocsForRequest(docs.accounts, docs.collections);
}


export const handleMsgNewCollection = async (event: StringEvent, client: IndexerStargateClient): Promise<void> => {
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    const docs: Docs = await fetchDocsForRequest([], [collection.collectionId]);

    collection.collectionMetadata = await fetchMetadata(collection.collectionUri);
    collection.badgeMetadata = await fetchBadgeMetadata(
        {
            start: 0,
            end: Number(collection?.nextBadgeId) - 1
        },
        collection.badgeUri
    );

    collection.claims = await fetchClaims(collection);

    await handleNewAccount(Number(collection.manager), client);


    console.log(collection.collectionId);


    docs.collections[collection.collectionId] = {
        _id: docs.collections[collection.collectionId]._id,
        ...collection
    };

    docs.collections[collection.collectionId].balances = {};
    docs.collections[collection.collectionId].usedClaims = [];
    docs.collections[collection.collectionId].managerRequests = [];
    docs.collections[collection.collectionId].activity = [];
    docs.collections[collection.collectionId].originalClaims = collection.claims;

    await finalizeDocsForRequest(docs.accounts, docs.collections);

    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));

    await handleTransfers(collection, transfers);

    for (const transfer of transfers) {
        for (const address of transfer.toAddresses) {
            await handleNewAccount(Number(address), client);
        }
    }
}