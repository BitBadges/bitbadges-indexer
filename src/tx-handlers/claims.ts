import { PASSWORDS_DB } from "../db/db";
import { fetchUri } from "../metadata-queue";
import { BadgeCollection, ClaimItem } from "../types";
import nano from "nano";


export const fetchClaims = async (collection: BadgeCollection) => {
    try {
        //Handle claim objects
        for (let idx = 0; idx < collection.claims.length; idx++) {
            let claim = collection.claims[idx];

            if (claim.uri) {
                try {
                    let fetchedFile = await fetchUri(claim.uri);

                    //The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
                    //If the collection was created through our API, we previously made a document in PASSWORDS_DB with docClaimedByCollection = false
                    //To prevent duplicates, we "claim" the document by setting docClaimedByCollection = true
                    //We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
                    const ipfsRegex = /^https?:\/\/(?:www\.)?ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/;
                    const match = claim.uri.match(ipfsRegex);

                    if (match) {
                        const cid = match[1];

                        if (claim.uri.startsWith('ipfs://')) {
                            const docQuery: nano.MangoQuery = {
                                selector: {
                                    docClaimedByCollection: false,
                                    cid: cid
                                }
                            }

                            const docResult = await PASSWORDS_DB.find(docQuery);
                            if (docResult.docs.length) {
                                const doc = docResult.docs[0];

                                await PASSWORDS_DB.insert({
                                    ...doc,
                                    docClaimedByCollection: true,
                                    collectionId: collection.collectionId,
                                    claimId: idx
                                });
                            }
                        }
                    }

                    const fetchedAddresses = fetchedFile.addresses ? fetchedFile.addresses : [];
                    const fetchedCodes = fetchedFile.codes ? fetchedFile.codes : [];

                    const claimItems: ClaimItem = {
                        ...claim,
                        codes: fetchedCodes,
                        addresses: fetchedAddresses,
                        hasPassword: fetchedFile.hasPassword
                    };

                    collection.claims[idx] = claimItems;
                } catch (e) {
                    console.log(`Error fetching claim file for ${claim.uri}: ${e}`);
                    collection.claims[idx] = {
                        ...claim,
                        codes: [],
                        addresses: [],
                        hasPassword: false,
                        failedToFetch: true
                    } as ClaimItem;
                }
            } else {
                const claimItems: ClaimItem = {
                    ...claim,
                    codes: [],
                    addresses: [],
                    hasPassword: false
                };
                collection.claims[idx] = claimItems;
            }
        }

        return collection.claims;
    } catch (e) {
        throw `Error in fetchClaims(): ${e}`
    }
}
