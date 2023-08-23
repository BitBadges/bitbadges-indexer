import { CollectionDoc, DocsCache, StatusDoc, convertToCosmosAddress } from "bitbadgesjs-utils";
import nano from "nano";
import { CLAIM_ALERTS_DB, PASSWORDS_DB, insertToDB } from "../db/db";
import { getMerkleChallengeIdForQueueDb, pushMerkleChallengeFetchToQueue } from "../metadata-queue";
import { getLoadBalancerId } from "../utils/loadBalancer";


export const handleMerkleChallenges = async (docs: DocsCache, collectionDoc: CollectionDoc<bigint>, status: StatusDoc<bigint>) => {

  try {
    //Handle claim objects
    //Note we only handle each unique URI once per collection, even if there is multiple claims with the same (thus you can't duplicate passwords for the same URI)
    const handledUris: string[] = [];

    for (const timelineVal of collectionDoc.collectionApprovedTransfersTimeline) {
      for (const approvedTransfer of timelineVal.collectionApprovedTransfers) {
        for (const approvedDetails of approvedTransfer.approvalDetails) {
          for (const merkleChallenge of approvedDetails.merkleChallenges) {
            if (merkleChallenge.uri) {
              if (!handledUris.includes(merkleChallenge.uri)) {
                handledUris.push(merkleChallenge.uri);

                const entropy = status.block.height + "-" + status.block.txIndex;
                const claimDocId = getMerkleChallengeIdForQueueDb(entropy, collectionDoc.collectionId.toString(), merkleChallenge.uri.toString());

                await pushMerkleChallengeFetchToQueue(docs, collectionDoc, merkleChallenge, getLoadBalancerId(claimDocId), status.block.timestamp, entropy);


                //The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
                //If the collection was created through our API, we previously made a document in PASSWORDS_DB with docClaimedByCollection = false and the correct passwords
                //To prevent duplicates, we "claim" the document by setting docClaimedByCollection = true
                //We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
                if (merkleChallenge.uri.startsWith('ipfs://')) {
                  const cid = merkleChallenge.uri.replace('ipfs://', '').split('/')[0];

                  const docQuery: nano.MangoQuery = {
                    selector: {
                      docClaimedByCollection: {
                        "$eq": false
                      },
                      cid: {
                        "$eq": cid
                      },
                      createdBy: {
                        "$eq": collectionDoc.createdBy
                      }
                    }
                  }

                  const docResult = await PASSWORDS_DB.find(docQuery);
                  if (docResult.docs.length) {
                    const doc = docResult.docs[0];

                    await insertToDB(PASSWORDS_DB, {
                      ...doc,
                      docClaimedByCollection: true,
                      collectionId: collectionDoc.collectionId.toString(),
                    });


                    if (merkleChallenge.useCreatorAddressAsLeaf) {
                      if (doc.challengeDetails?.leavesDetails.isHashed == false) {
                        const addresses = doc.challengeDetails?.leavesDetails.leaves.map(leaf => convertToCosmosAddress(leaf));
                        const orderMatters = merkleChallenge.useLeafIndexForTransferOrder == true;

                        let idx = 0;
                        for (const address of addresses) {
                          await insertToDB(CLAIM_ALERTS_DB, {
                            _id: `${address}:${status.block.height}-${status.block.txIndex}-${idx}`,
                            createdTimestamp: status.block.timestamp,
                            collectionId: collectionDoc.collectionId.toString(),
                            message: `You have been whitelisted to claim badges from collection ${collectionDoc.collectionId}! ${orderMatters ? `You have been reserved specific badges which are only claimable to you. Your claim number is #${idx + 1}` : ''}`,
                          });
                          idx++;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    throw `Error in handleMerkleChallenges(): ${e}`
  }
}
