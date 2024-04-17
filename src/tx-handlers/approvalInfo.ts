import { ClaimAlertDoc, ClaimBuilderDoc, convertToCosmosAddress, type CollectionDoc, type StatusDoc } from 'bitbadgesjs-sdk';
import { deleteMany, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel, CollectionModel } from '../db/schemas';
import { type DocsCache } from '../db/types';
import { getFromIpfs } from '../ipfs/ipfs';
import { getApprovalInfoIdForQueueDb, pushApprovalInfoFetchToQueue } from '../queue';
import { getLoadBalancerId } from '../utils/loadBalancer';

export const handleApprovals = async (
  docs: DocsCache,
  collectionDoc: CollectionDoc<bigint>,
  status: StatusDoc<bigint>,
  isCreateTx: boolean
): Promise<void> => {
  try {
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

        const docQuery = {
          docClaimed: false,
          cid,
          createdBy: collectionDoc.createdBy
        };

        const docResult = await findInDB(ClaimBuilderModel, { query: docQuery });
        if (docResult.length > 0) {
          const convertedDoc = docResult[0];

          docs.claimBuilderDocs[convertedDoc._docId] = new ClaimBuilderDoc({
            ...convertedDoc,
            docClaimed: true,
            collectionId: collectionDoc.collectionId
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

    // For on-chain approvals with off-chain claim builders, we delete the claim builder docs that are no longer in the collectionApprovals
    // TODO: Handle case where deleted then re-added? Just do not delete them?
    if (!isCreateTx) {
      const oldDoc = await mustGetFromDB(CollectionModel, collectionDoc.collectionId.toString());
      const oldCids: string[] = oldDoc.collectionApprovals
        .map((approval) => approval.approvalCriteria?.merkleChallenges?.map((y) => y.challengeTrackerId))
        .flat()
        .filter((x) => x) as string[];
      const newCids: string[] = collectionDoc.collectionApprovals
        .map((approval) => approval.approvalCriteria?.merkleChallenges?.map((y) => y.challengeTrackerId))
        .flat()
        .filter((x) => x) as string[];

      const docIdsToDelete = [...new Set(oldCids)].filter((cid) => ![...new Set(newCids)].includes(cid));

      const docs = await findInDB(ClaimBuilderModel, { query: { cid: { $in: docIdsToDelete } } });
      if (docs.length > 0) {
        await deleteMany(
          ClaimBuilderModel,
          docs.map((doc) => doc._docId)
        );
      }
    }
  } catch (e) {
    throw new Error(`Error in handleApprovals(): ${e}`);
  }
};
