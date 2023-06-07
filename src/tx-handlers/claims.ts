import { Claim } from "bitbadgesjs-proto";
import { ClaimDoc, DocsCache, StatusDoc } from "bitbadgesjs-utils";
import nano from "nano";
import { getClaimIdForQueueDb, pushClaimFetchToQueue } from "src/metadata-queue";
import { getLoadBalancerId } from "src/utils/loadBalancer";
import { PASSWORDS_DB, insertToDB } from "../db/db";


export const handleClaims = async (docs: DocsCache, claims: Claim<bigint>[], collectionId: bigint, startAt = 0, status: StatusDoc<bigint>) => {
  const collectionDoc = docs.collections[collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${collectionId} does not exist`);

  try {
    //Handle claim objects
    for (let idx = startAt; idx < claims.length; idx++) {
      collectionDoc.nextClaimId++;

      const claim = claims[idx];
      let claimDocument: ClaimDoc<bigint>;

      if (claim.uri) {
        const entropy = status.block.height + "-" + status.block.txIndex;
        const claimDocId = getClaimIdForQueueDb(entropy, collectionId.toString(), collectionDoc.nextClaimId.toString());
        await pushClaimFetchToQueue(docs, collectionDoc, claim, collectionDoc.nextClaimId, getLoadBalancerId(claimDocId), status.block.timestamp, entropy);


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

            await insertToDB(PASSWORDS_DB, {
              ...doc,
              docClaimedByCollection: true,
              collectionId: collectionId.toString(),
              claimId: BigInt(idx + 1).toString(),
            });
          }
        }
      }
      const partitionedId = `${collectionId.toString()}:${BigInt(idx + 1).toString()}`;
      claimDocument = {
        ...claim,
        _id: partitionedId,
        _rev: '',
        usedLeafIndices: [...claim.challenges.map(() => [])],
        collectionId: collectionId,
        claimId: BigInt(idx + 1),
        totalClaimsProcessed: BigInt(0),
        claimsPerAddressCount: {},
      };

      docs.claims[partitionedId] = {
        ...claimDocument
      };
    }
  } catch (e) {
    throw `Error in fetchClaims(): ${e}`
  }
}
