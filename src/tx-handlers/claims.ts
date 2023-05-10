import { Claims } from "bitbadgesjs-proto";
import { ClaimDocument, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";
import { PASSWORDS_DB } from "../db/db";
import { fetchUri } from "../metadata-queue";


export const handleClaims = async (docs: DocsCache, claims: Claims[], collectionId: number, startAt = 0) => {
  try {
    //Handle claim objects
    for (let idx = startAt; idx < claims.length; idx++) {
      const claim = claims[idx];
      let claimDocument: ClaimDocument | undefined = undefined;

      if (claim.uri) {
        try {
          let fetchedFile = await fetchUri(claim.uri);

          //The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
          //If the collection was created through our API, we previously made a document in PASSWORDS_DB with docClaimedByCollection = false
          //To prevent duplicates, we "claim" the document by setting docClaimedByCollection = true
          //We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
          if (claim.uri.startsWith('ipfs://')) {
            const cid = claim.uri.replace('ipfs://', '').split('/')[0];

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
            if (docResult.docs.length) {
              const doc = docResult.docs[0];

              await PASSWORDS_DB.insert({
                ...doc,
                docClaimedByCollection: true,
                collectionId: collectionId,
                claimId: idx + 1
              });
            }
          }

          const fetchedAddresses = fetchedFile.addresses ? fetchedFile.addresses : [];
          const fetchedCodes = fetchedFile.codes ? fetchedFile.codes : [];
          const fetchedName = fetchedFile.name ? fetchedFile.name : ""
          const fetchedDescription = fetchedFile.description ? fetchedFile.description : ""

          claimDocument = {
            ...claim,
            hashedCodes: fetchedCodes,
            addresses: fetchedAddresses,
            hasPassword: fetchedFile.hasPassword,
            name: fetchedName,
            description: fetchedDescription,
            collectionId: collectionId,
            claimId: idx + 1,
            usedClaims: {
              codes: {},
              numUsed: 0,
              addresses: {}
            }
          };

          docs.claims[claimDocument.claimId] = {
            _id: `${claimDocument.collectionId}:${claimDocument.claimId}`,
            ...claimDocument
          } as ClaimDocument & nano.DocumentGetResponse;


        } catch (e) {
          console.log(`Error fetching claim file for ${claim.uri}: ${e}`);
          claimDocument = {
            ...claim,
            hashedCodes: [],
            addresses: [],
            hasPassword: false,
            failedToFetch: true,
            name: '',
            description: '',
            collectionId: collectionId,
            claimId: idx + 1,
            usedClaims: {
              codes: {},
              numUsed: 0,
              addresses: {}
            }
          } as ClaimDocument;

          docs.claims[claimDocument.claimId] = {
            _id: `${claimDocument.collectionId}:${claimDocument.claimId}`,
            ...claimDocument
          } as ClaimDocument & nano.DocumentGetResponse;
        }
      } else {
        claimDocument = {
          ...claim,
          hashedCodes: [],
          addresses: [],
          hasPassword: false,
          failedToFetch: true,
          name: '',
          description: '',
          collectionId: collectionId,
          claimId: idx + 1,
          usedClaims: {
            codes: {},
            numUsed: 0,
            addresses: {}
          }
        };

        docs.claims[claimDocument.claimId] = {
          _id: `${claimDocument.collectionId}:${claimDocument.claimId}`,
          ...claimDocument
        } as ClaimDocument & nano.DocumentGetResponse;
      }
    }
  } catch (e) {
    throw `Error in fetchClaims(): ${e}`
  }
}
