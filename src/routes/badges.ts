import {
  BigIntify,
  ClaimDetails,
  iApprovalInfoDetails,
  iChallengeDetails,
  type ErrorResponse,
  type GetOwnersForBadgePayload,
  type NumberType,
  type iAddressList,
  type iApprovalCriteria,
  type iGetOwnersForBadgeSuccessResponse,
  type iIncomingApprovalCriteria,
  type iOutgoingApprovalCriteria
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { BalanceModel, ClaimBuilderModel } from '../db/schemas';
import { fetchUrisFromDbAndAddToQueueIfEmpty } from '../queue';
import { applyAddressListsToUserPermissions } from './balances';
import { getClaimDetailsForFrontend } from './collections';
import { getAddressListsFromDB } from './utils';
import typia from 'typia';
import { typiaError } from './search';

export const getOwnersForBadge = async (req: Request, res: Response<iGetOwnersForBadgeSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqPayload = req.body as unknown as GetOwnersForBadgePayload;
    const validateRes: typia.IValidation<GetOwnersForBadgePayload> = typia.validate<GetOwnersForBadgePayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    //validate collectionId and badgeId
    typia.assert<NumberType>(req.params.collectionId);
    typia.assert<NumberType>(req.params.badgeId);
    BigIntify(req.params.collectionId);
    BigIntify(req.params.badgeId);

    const totalSupplys = await mustGetFromDB(BalanceModel, `${req.params.collectionId}:Total`);
    let maxBadgeId = 1n;
    for (const balance of totalSupplys.balances) {
      for (const badgeId of balance.badgeIds) {
        if (BigInt(badgeId.end) > maxBadgeId) {
          maxBadgeId = BigInt(badgeId.end);
        }
      }
    }

    if (BigInt(maxBadgeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('This collection has >2^53 badges. Such collections are not supported.');
    }

    const ownersRes = await findInDB(BalanceModel, {
      query: {
        cosmosAddress: {
          // does not equal mint OR total
          $nin: ['Mint', 'Total']
        },
        collectionId: Number(req.params.collectionId),
        balances: {
          $elemMatch: {
            badgeIds: {
              $elemMatch: {
                start: {
                  $lte: Number(req.params.badgeId),
                  $type: 'number'
                },
                end: {
                  $gte: Number(req.params.badgeId),
                  $type: 'number'
                }
              }
            }
          }
        }
      },
      skip: reqPayload.bookmark ? 25 * Number(reqPayload.bookmark) : 0,
      limit: 25
    });

    const newBookmark = (reqPayload.bookmark ? Number(reqPayload.bookmark) + 1 : 1).toString();

    let addressListIdsToFetch = [];
    for (const balanceDoc of ownersRes) {
      for (const incomingTransfer of balanceDoc.incomingApprovals) {
        addressListIdsToFetch.push(incomingTransfer.fromListId);
        addressListIdsToFetch.push(incomingTransfer.initiatedByListId);
      }

      for (const outgoingTransfer of balanceDoc.outgoingApprovals) {
        addressListIdsToFetch.push(outgoingTransfer.toListId);
        addressListIdsToFetch.push(outgoingTransfer.initiatedByListId);
      }

      for (const incomingTransfer of balanceDoc.userPermissions.canUpdateIncomingApprovals) {
        addressListIdsToFetch.push(incomingTransfer.fromListId);
        addressListIdsToFetch.push(incomingTransfer.initiatedByListId);
      }

      for (const outgoingTransfer of balanceDoc.userPermissions.canUpdateOutgoingApprovals) {
        addressListIdsToFetch.push(outgoingTransfer.toListId);
        addressListIdsToFetch.push(outgoingTransfer.initiatedByListId);
      }
    }

    addressListIdsToFetch = [...new Set(addressListIdsToFetch)];

    const addressLists = await getAddressListsFromDB(
      addressListIdsToFetch.map((x) => {
        return { listId: x };
      }),
      false
    );

    const urisToFetch = [
      ...ownersRes.flatMap((x) => x.incomingApprovals.map((y) => y.uri)),
      ...ownersRes.flatMap((x) => x.outgoingApprovals.map((y) => y.uri)),
      ...ownersRes.flatMap((x) => x.incomingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri))),
      ...ownersRes.flatMap((x) => x.outgoingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.map((z) => z.uri)))
    ]
      .filter((x) => x)
      .filter((x, i, arr) => arr.indexOf(x) === i) as string[];

    const claimIds = [
      ...ownersRes.flatMap((x) => x.incomingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.flatMap((z) => z.challengeTrackerId))),
      ...ownersRes.flatMap((x) => x.outgoingApprovals.flatMap((y) => y.approvalCriteria?.merkleChallenges?.flatMap((z) => z.challengeTrackerId)))
    ]
      .filter((x) => x)
      .filter((x, i, arr) => arr.indexOf(x) === i) as string[];

    const docs = await findInDB(ClaimBuilderModel, {
      query: {
        collectionId: Number(req.params.collectionId),
        docClaimed: true,
        cid: {
          $in: claimIds
        },
        deletedAt: { $exists: false }
      }
    });

    const claimDetails: Array<ClaimDetails<bigint>> = [];
    if (docs.length > 0) {
      for (const doc of docs) {
        const newClaimDetails = await getClaimDetailsForFrontend(req, res, [doc], false, doc.trackerDetails);
        claimDetails.push(...newClaimDetails);
      }
    }

    const results = await fetchUrisFromDbAndAddToQueueIfEmpty(urisToFetch, req.params.collectionId);

    return res.status(200).send({
      owners: ownersRes.map((balance) => {
        return {
          ...balance,
          incomingApprovals: balance.incomingApprovals.map((y) => {
            return {
              ...y,
              details: results.find((x) => x.uri === y.uri) as iApprovalInfoDetails | undefined,
              fromList: addressLists.find((list) => list.listId === y.fromListId) as iAddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as iAddressList,
              approvalCriteria: addChallengeDetailsToCriteria(
                y.approvalCriteria,
                results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[],
                claimDetails
              )
            };
          }),
          outgoingApprovals: balance.outgoingApprovals.map((y) => {
            return {
              ...y,
              details: results.find((x) => x.uri === y.uri) as iApprovalInfoDetails | undefined,
              toList: addressLists.find((list) => list.listId === y.toListId) as iAddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as iAddressList,
              approvalCriteria: addChallengeDetailsToCriteria(
                y.approvalCriteria,
                results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[],
                claimDetails
              )
            };
          }),
          userPermissions: applyAddressListsToUserPermissions(balance.userPermissions, addressLists)
        };
      }),
      pagination: {
        bookmark: newBookmark.toString(),
        hasMore: ownersRes.length === 25
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error fetching owners for collection.'
    });
  }
};

export function addChallengeDetailsToCriteria(
  approvalCriteria?: iApprovalCriteria<bigint> | iIncomingApprovalCriteria<bigint> | iOutgoingApprovalCriteria<bigint>,
  results?: ({ uri: string; content: iChallengeDetails<NumberType> | undefined } | undefined)[],
  claimDetails?: Array<ClaimDetails<NumberType>>
) {
  if (!approvalCriteria) return approvalCriteria;

  return {
    ...approvalCriteria,
    merkleChallenges: approvalCriteria.merkleChallenges?.map((y) => {
      return {
        ...y,
        challengeInfoDetails: {
          challengeDetails: results?.find((x) => x?.uri === y.uri)?.content ?? {
            leaves: [],
            isHashed: false
          },
          claim: claimDetails?.find((x) => x.claimId === y.challengeTrackerId) //TODO: We should have more checks here to avoid assigning a claim to the wrong challenge
        }
      };
    })
  };
}
