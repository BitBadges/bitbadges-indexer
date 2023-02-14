import axios from "axios"
import { StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { SHA256 } from 'crypto-js'
import MerkleTree from "merkletreejs"
import { getAttributeValueByKey } from "../indexer"
import { getFromIpfs } from "../ipfs/getFromIpfs"
import { BadgeCollection, BadgeMetadata, DbType, DistributionMethod, IdRange, Transfers } from "../types"
import { cleanBadgeCollection, cleanTransfers } from "../util/dataCleaners"
import { AddBalancesForIdRanges } from "../util/balances-gpt"


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
                    const tree = new MerkleTree(fetchedLeaves, SHA256);
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].tree = tree;
                    collection.claims[idx].distributionMethod = DistributionMethod.Codes;
                } else {
                    //Is a list of specific codes with addresses
                    const tree = new MerkleTree(fetchedLeaves.map((x) => SHA256(x)), SHA256);
                    collection.claims[idx].leaves = fetchedLeaves;
                    collection.claims[idx].tree = tree;
                    collection.claims[idx].distributionMethod = DistributionMethod.Whitelist;
                }
            }
        }
    }

    return collection.claims;
}

export const handleTransfers = async (collection: BadgeCollection, transfers: Transfers[], db: DbType) => {
    for (let idx = 0; idx < transfers.length; idx++) {
        let transfer = transfers[idx];
        for (let j = 0; j < transfer.toAddresses.length; j++) {
            let address = transfer.toAddresses[j];

            let currBalance = db.collections[collection.collectionId].balances[address]
                ? db.collections[collection.collectionId].balances[address]
                : {
                    balances: [],
                    approvals: [],
                };

            for (const transferBalanceObj of transfer.balances) {
                db.collections[collection.collectionId].balances[address] = AddBalancesForIdRanges(currBalance, transferBalanceObj.badgeIds, transferBalanceObj.balance);
            }
        }
    }
}


export const handleMsgNewCollection = async (event: StringEvent, db: DbType): Promise<void> => {
    console.log("ENTERED");
    const collectionString: string | undefined = getAttributeValueByKey(event.attributes, "collection");
    if (!collectionString) throw new Error(`New Collection event missing collection`);

    const collection: BadgeCollection = cleanBadgeCollection(JSON.parse(collectionString));
    collection.collectionMetadata = await fetchMetadata(collection.collectionUri);
    collection.badgeMetadata = await fetchBadgeMetadata(
        {
            start: 0,
            end: Number(collection?.nextBadgeId) - 1
        },
        collection.badgeUri
    );

    collection.claims = await fetchClaims(collection);


    console.log(collection.collectionId);


    db.collections[collection.collectionId] = collection;
    db.collections[collection.collectionId].balances = {};
    db.collections[collection.collectionId].usedClaims = [];
    db.collections[collection.collectionId].maangerRequests = [];


    const transfersString: string | undefined = getAttributeValueByKey(event.attributes, "transfers");
    if (!transfersString) throw new Error(`New Collection event missing transfers`)
    const transfers: Transfers[] = cleanTransfers(JSON.parse(transfersString));
    await handleTransfers(collection, transfers, db);
}