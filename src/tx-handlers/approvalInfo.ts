import {
  ChallengeTrackerIdDetails,
  ClaimAlertDoc,
  ClaimBuilderDoc,
  convertToCosmosAddress,
  type CollectionDoc,
  type StatusDoc,
  MsgUniversalUpdateCollection
} from 'bitbadgesjs-sdk';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel } from '../db/schemas';
import { type DocsCache } from '../db/types';
import { getFromIpfs } from '../ipfs/ipfs';
import { getApprovalInfoIdForQueueDb, pushApprovalInfoFetchToQueue } from '../queue';
import { getLoadBalancerId } from '../utils/loadBalancer';

export const handleApprovals = async (
  docs: DocsCache,
  collectionDoc: CollectionDoc<bigint>,
  status: StatusDoc<bigint>,
  msg: MsgUniversalUpdateCollection<bigint>
): Promise<void> => {
  // Handle claim objects
  // Note we only handle each unique URI once per collection, even if there is multiple claims with the same (thus you can't duplicate passwords for the same URI)
  const handledUris: string[] = [];
  let idx = 0;
  for (const approval of collectionDoc.collectionApprovals) {
    const approvalCriteria = approval.approvalCriteria;
    const merkleChallenges = approvalCriteria?.merkleChallenges;
    if (approval?.uri) {
      if (!handledUris.includes(approval.uri)) {
        handledUris.push(approval.uri);

        const entropy = status.block.height + '-' + status.block.txIndex;
        const claimDocId = getApprovalInfoIdForQueueDb(entropy, collectionDoc.collectionId.toString(), approval.uri.toString());

        await pushApprovalInfoFetchToQueue(docs, collectionDoc, approval.uri, getLoadBalancerId(claimDocId), status.block.timestamp, entropy);
      }
    }

    // The following is to handle if there are multiple claims using the same uri (and thus the same file contents)
    // If the collection was created through our API, we previously made a document in ClaimBuilderModel with docClaimed = false and the correct passwords
    // To prevent duplicates, we "claim" the document by setting docClaimed = true
    // We need this claiming process because we don't know the collection and claim IDs until after the collection is created on the blockchain
    for (const merkleChallenge of merkleChallenges ?? []) {
      const cid = merkleChallenge.challengeTrackerId;

      const existingDoc = await findInDB(ClaimBuilderModel, {
        query: {
          cid,
          deletedAt: { $exists: false },
          docClaimed: true,
          'trackerDetails.challengeTrackerId': cid,
          'trackerDetails.collectionId': Number(collectionDoc.collectionId),
          'trackerDetails.approvalId': approval.approvalId,
          'trackerDetails.approvalLevel': 'collection',
          'trackerDetails.approverAddress': ''
        }
      });
      if (existingDoc.length > 0) {
        continue;
      }

      const docQuery = {
        docClaimed: false,
        cid,
        createdBy: msg.creator,
        deletedAt: { $exists: false }
      };
      const docResult = await findInDB(ClaimBuilderModel, { query: docQuery });
      if (docResult.length > 0) {
        const convertedDoc = docResult[0];

        docs.claimBuilderDocs[convertedDoc._docId] = new ClaimBuilderDoc({
          ...convertedDoc,
          docClaimed: true,
          collectionId: collectionDoc.collectionId,
          trackerDetails: new ChallengeTrackerIdDetails({
            collectionId: collectionDoc.collectionId,
            approvalId: approval.approvalId,
            challengeTrackerId: cid,
            approvalLevel: 'collection',
            approverAddress: ''
          })
        });

        if (merkleChallenge?.useCreatorAddressAsLeaf) {
          const res = await getFromIpfs(cid);
          const convertedDoc = JSON.parse(res.file);

          if (convertedDoc.challengeDetails?.isHashed === false) {
            const addresses = convertedDoc.challengeDetails?.leaves.map((leaf: string) => convertToCosmosAddress(leaf));

            const orderMatters = approvalCriteria?.predeterminedBalances?.orderCalculationMethod?.useMerkleChallengeLeafIndex;
            docs.claimAlertsToAdd.push(
              new ClaimAlertDoc({
                from: '',
                _docId: `${collectionDoc.collectionId}:${status.block.height}-${status.block.txIndex}-${idx}`,
                timestamp: status.block.timestamp,
                block: status.block.height,
                collectionId: collectionDoc.collectionId,
                cosmosAddresses: addresses,
                message: `You have been whitelisted to claim badges from collection ${collectionDoc.collectionId}! ${orderMatters ? `You have been reserved specific badges which are only claimable to you. Your claim number is #${idx + 1}` : ''}`
              })
            );
            idx++;
          }
        }
      }
    }
  }

  //TODO: We could flag any claim docs that are no longer with a deletedAt timestamp
  //      Should always be tied to the challenge tracker on-chain though (and can be reinstated if the challenge tracker is reinstated)
};
