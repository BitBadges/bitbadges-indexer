import { StoredBadgeCollection, ClaimItem } from "bitbadgesjs-utils";
import { PASSWORDS_DB } from "../db/db";
import { fetchUri } from "../metadata-queue";
import nano from "nano";


export const fetchClaims = async (collection: StoredBadgeCollection, startAt = 0) => {
    try {
        //Handle claim objects
        for (let idx = startAt; idx < collection.claims.length; idx++) {
            let claim = collection.claims[idx];

            if (claim.uri) {
                try {
                    let fetchedFile = await fetchUri(claim.uri);

                    //The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
                    //If the collection was created through our API, we previously made a document in PASSWORDS_DB with docClaimedByCollection = false
                    //To prevent duplicates, we "claim" the document by setting docClaimedByCollection = true
                    //We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
                    if (claim.uri.startsWith('ipfs://')) {
                        const cid = claim.uri.replace('ipfs://', '').split('/')[0];
                        console.log(cid);
                        const docQuery: nano.MangoQuery = {
                            selector: {
                                docClaimedByCollection: {
                                    "$eq": false
                                },
                                cid: {
                                    "$eq": cid
                                }
                            }
                        }

                        const docResult = await PASSWORDS_DB.find(docQuery);

                        console.log(docResult);
                        if (docResult.docs.length) {
                            const doc = docResult.docs[0];

                            await PASSWORDS_DB.insert({
                                ...doc,
                                docClaimedByCollection: true,
                                collectionId: collection.collectionId,
                                claimId: idx + 1
                            });
                        }
                    }

                    const fetchedAddresses = fetchedFile.addresses ? fetchedFile.addresses : [];
                    const fetchedCodes = fetchedFile.codes ? fetchedFile.codes : [];
                    const fetchedName = fetchedFile.name ? fetchedFile.name : ""
                    const fetchedDescription = fetchedFile.description ? fetchedFile.description : ""

                    const claimItems: ClaimItem = {
                        ...claim,
                        hashedCodes: fetchedCodes,
                        codes: [],
                        addresses: fetchedAddresses,
                        hasPassword: fetchedFile.hasPassword,
                        name: fetchedName,
                        description: fetchedDescription
                    };

                    collection.claims[idx] = claimItems;
                } catch (e) {
                    console.log(`Error fetching claim file for ${claim.uri}: ${e}`);
                    collection.claims[idx] = {
                        ...claim,
                        codes: [],
                        hashedCodes: [],
                        addresses: [],
                        hasPassword: false,
                        failedToFetch: true,
                        name: '',
                        description: ''
                    } as ClaimItem;
                }
            } else {
                const claimItems: ClaimItem = {
                    ...claim,
                    codes: [],
                    hashedCodes: [],
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
