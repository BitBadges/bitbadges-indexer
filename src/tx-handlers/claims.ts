import { Claim } from "bitbadgesjs-proto";
import { LeavesDetails, ClaimDocument, DocsCache, ChallengeWithDetails, Collection } from "bitbadgesjs-utils";
import nano from "nano";
import { PASSWORDS_DB } from "../db/db";
import { fetchUri } from "../metadata-queue";


export const handleClaims = async (docs: DocsCache, claims: Claim[], collectionId: bigint, startAt = 0) => {
  const collectionDoc = docs.collections[collectionId.toString()] as Collection & nano.DocumentGetResponse;

  try {
    //Handle claim objects
    for (let idx = startAt; idx < claims.length; idx++) {
      collectionDoc.nextClaimId++;

      const claim = claims[idx];
      let claimDocument: ClaimDocument | undefined = undefined;


      if (claim.uri) {
        try {
          const fetchedFile = await fetchUri(claim.uri);

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
                collectionId: collectionId.toString(),
                claimId: BigInt(idx + 1).toString(),
              });
            }
          }

          const leavesDetails: LeavesDetails = fetchedFile.leavesDetails ? fetchedFile.leavesDetails : [];
          const name = fetchedFile.name ? fetchedFile.name : ""
          const description = fetchedFile.description ? fetchedFile.description : "";

          const challengesWithDetails: ChallengeWithDetails[] = claim.challenges.map((challenge) => {
            return {
              ...challenge,
              leavesDetails: leavesDetails,
              usedLeafIndices: [],
            }
          });

          claimDocument = {
            ...claim,
            challenges: challengesWithDetails,
            hasPassword: fetchedFile.hasPassword,
            name: name,
            description: description,
            collectionId: collectionId,
            claimId: BigInt(idx + 1),
            totalClaimsProcessed: BigInt(0),
            claimsPerAddressCount: {},
          };

          const partitionedId = `${claimDocument?.collectionId.toString()}:${claimDocument?.claimId.toString()}`;
          docs.claims[partitionedId] = {
            _id: partitionedId,
            ...claimDocument
          } as ClaimDocument & nano.DocumentGetResponse;


        } catch (e) {
          console.log(`Error fetching claim file for ${claim.uri}: ${e}`);
          claimDocument = {
            ...claim,
            challenges: claim.challenges.map((challenge) => {
              return {
                ...challenge,
                leavesDetails: {
                  leaves: [],
                  isHashed: false,
                },
                usedLeafIndices: [],
              }
            }),
            hasPassword: false,
            failedToFetch: true,
            name: '',
            description: '',
            collectionId: collectionId,
            claimId: BigInt(idx + 1),
            totalClaimsProcessed: BigInt(0),
            claimsPerAddressCount: {},
          } as ClaimDocument;

          const partitionedId = `${claimDocument?.collectionId.toString()}:${claimDocument?.claimId.toString()}`;
          docs.claims[partitionedId] = {
            _id: partitionedId,
            ...claimDocument
          } as ClaimDocument & nano.DocumentGetResponse;
        }
      } else {
        claimDocument = {
          ...claim,
          challenges: claim.challenges.map((challenge) => {
            return {
              ...challenge,
              leavesDetails: {
                leaves: [],
                isHashed: false,
              },
              usedLeafIndices: [],
            }
          }),
          hasPassword: false,
          failedToFetch: true,
          name: '',
          description: '',
          collectionId: collectionId,
          claimId: BigInt(idx + 1),
          totalClaimsProcessed: BigInt(0),
          claimsPerAddressCount: {},
        };

        const partitionedId = `${claimDocument?.collectionId.toString()}:${claimDocument?.claimId.toString()}`;
        docs.claims[partitionedId] = {
          _id: partitionedId,
          ...claimDocument
        } as ClaimDocument & nano.DocumentGetResponse;
      }
    }
  } catch (e) {
    throw `Error in fetchClaims(): ${e}`
  }
}
