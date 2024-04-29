import {
  ChallengeTrackerIdDetails,
  ClaimBuilderDoc,
  CollectionApproval,
  MsgUniversalUpdateCollection,
  MsgUpdateUserApprovals,
  UserIncomingApproval,
  UserOutgoingApproval,
  type CollectionDoc,
  type StatusDoc
} from 'bitbadgesjs-sdk';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel } from '../db/schemas';
import { type DocsCache } from '../db/types';
import { getApprovalInfoIdForQueueDb, pushApprovalInfoFetchToQueue } from '../queue';
import { getLoadBalancerId } from '../utils/loadBalancer';

export const handleUserApprovals = async (docs: DocsCache, status: StatusDoc<bigint>, msg: MsgUpdateUserApprovals<bigint>): Promise<void> => {
  if (msg.updateIncomingApprovals) {
    await handleApprovals(docs, msg.incomingApprovals ?? [], msg.collectionId, status, msg, undefined, 'incoming', msg.creator);
  }

  if (msg.updateOutgoingApprovals) {
    await handleApprovals(docs, msg.outgoingApprovals ?? [], msg.collectionId, status, msg, undefined, 'outgoing', msg.creator);
  }
};

export const handleApprovals = async (
  docs: DocsCache,
  approvals: CollectionApproval<bigint>[] | UserIncomingApproval<bigint>[] | UserOutgoingApproval<bigint>[],
  collectionId: bigint,
  status: StatusDoc<bigint>,
  msg: MsgUniversalUpdateCollection<bigint> | MsgUpdateUserApprovals<bigint>,
  collectionDoc?: CollectionDoc<bigint>,
  approvalLevel = 'collection',
  approverAddress = ''
): Promise<void> => {
  // Handle claim objects
  // Note we only handle each unique URI once per collection, even if there is multiple claims with the same (thus you can't duplicate passwords for the same URI)
  const handledUris: string[] = [];
  for (const approval of approvals) {
    const approvalCriteria = approval.approvalCriteria;
    const merkleChallenges = approvalCriteria?.merkleChallenges;
    if (approval?.uri) {
      if (!handledUris.includes(approval.uri)) {
        handledUris.push(approval.uri);

        if (collectionDoc) {
          const entropy = status.block.height + '-' + status.block.txIndex;
          const claimDocId = getApprovalInfoIdForQueueDb(entropy, collectionId.toString(), approval.uri.toString());

          await pushApprovalInfoFetchToQueue(docs, collectionDoc, approval.uri, getLoadBalancerId(claimDocId), status.block.timestamp, entropy);
        }
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
          'trackerDetails.collectionId': Number(collectionId),
          'trackerDetails.approvalId': approval.approvalId,

          'trackerDetails.approvalLevel': approvalLevel,
          'trackerDetails.approverAddress': approverAddress
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
          collectionId: collectionId,
          trackerDetails: new ChallengeTrackerIdDetails({
            collectionId: collectionId,
            approvalId: approval.approvalId,
            challengeTrackerId: cid,
            approvalLevel: approvalLevel as 'collection' | 'incoming' | 'outgoing',
            approverAddress
          })
        });
      }
    }
  }

  //TODO: We could flag any claim docs that are no longer with a deletedAt timestamp
  //      Should always be tied to the challenge tracker on-chain though (and can be reinstated if the challenge tracker is reinstated)
};
