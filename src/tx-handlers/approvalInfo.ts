import { BigIntify, CollectionDoc, DocsCache, StatusDoc, convertPasswordDoc, convertToCosmosAddress } from "bitbadgesjs-utils";
import nano from "nano";
import { PASSWORDS_DB } from "../db/db";
import { getApprovalInfoIdForQueueDb, pushApprovalInfoFetchToQueue } from "../queue";
import { getLoadBalancerId } from "../utils/loadBalancer";


export const handleMerkleChallenges = async (docs: DocsCache, collectionDoc: CollectionDoc<bigint>, status: StatusDoc<bigint>) => {

  try {
    //Handle claim objects
    //Note we only handle each unique URI once per collection, even if there is multiple claims with the same (thus you can't duplicate passwords for the same URI)
    const handledUris: string[] = [];
    let idx = 0;
    for (const approval of collectionDoc.collectionApprovals) {
      const approvalCriteria = approval.approvalCriteria;
      const merkleChallenge = approvalCriteria?.merkleChallenge;
      if (approval?.uri) {
        if (!handledUris.includes(approval.uri)) {
          handledUris.push(approval.uri);

          const entropy = status.block.height + "-" + status.block.txIndex;
          const claimDocId = getApprovalInfoIdForQueueDb(entropy, collectionDoc.collectionId.toString(), approval.uri.toString());

          await pushApprovalInfoFetchToQueue(docs, collectionDoc, approval.uri, getLoadBalancerId(claimDocId), status.block.timestamp, entropy);


          //The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
          //If the collection was created through our API, we previously made a document in PASSWORDS_DB with docClaimedByCollection = false and the correct passwords
          //To prevent duplicates, we "claim" the document by setting docClaimedByCollection = true
          //We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
          if (approval.uri.startsWith('ipfs://')) {
            const cid = approval.uri.replace('ipfs://', '').split('/')[0];

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

              docs.passwordDocs[doc._id] = {
                ...convertPasswordDoc(doc, BigIntify),
                docClaimedByCollection: true,
                collectionId: collectionDoc.collectionId,
              }

              if (merkleChallenge?.useCreatorAddressAsLeaf) {
                if (doc.challengeDetails?.leavesDetails.isHashed == false) {
                  const addresses = doc.challengeDetails?.leavesDetails.leaves.map(leaf => convertToCosmosAddress(leaf));
                  const orderMatters = approvalCriteria?.predeterminedBalances?.orderCalculationMethod?.useMerkleChallengeLeafIndex;
                  docs.claimAlertsToAdd.push({
                    _id: `${collectionDoc.collectionId}:${status.block.height}-${status.block.txIndex}-${idx}`,
                    createdTimestamp: status.block.timestamp,
                    collectionId: collectionDoc.collectionId,
                    cosmosAddresses: addresses,
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
  } catch (e) {
    throw `Error in handleMerkleChallenges(): ${e}`
  }
}
