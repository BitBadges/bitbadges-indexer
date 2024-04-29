import {
  iApprovalInfoDetails,
  type ErrorResponse,
  type GetOwnersForBadgeRouteRequestBody,
  type NumberType,
  type iAddressList,
  type iApprovalCriteria,
  type iGetOwnersForBadgeRouteSuccessResponse,
  type iIncomingApprovalCriteria,
  type iOutgoingApprovalCriteria,
  iChallengeDetails,
  iMerkleChallenge
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { BalanceModel } from '../db/schemas';
import { fetchUrisFromDbAndAddToQueueIfEmpty } from '../queue';
import { applyAddressListsToUserPermissions } from './balances';
import { getAddressListsFromDB } from './utils';

export const getOwnersForBadge = async (req: Request, res: Response<iGetOwnersForBadgeRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetOwnersForBadgeRouteRequestBody;

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
      skip: reqBody.bookmark ? 25 * Number(reqBody.bookmark) : 0,
      limit: 25
    });

    const newBookmark = (reqBody.bookmark ? Number(reqBody.bookmark) + 1 : 1).toString();

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
                results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[]
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
                results as { uri: string; content: iChallengeDetails<NumberType> | undefined }[]
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
      error: serializeError(e),
      errorMessage: 'Error fetching owners for collection.'
    });
  }
};

export function addChallengeDetailsToCriteria(
  approvalCriteria?: iApprovalCriteria<bigint> | iIncomingApprovalCriteria<bigint> | iOutgoingApprovalCriteria<bigint>,
  results?: ({ uri: string; content: iChallengeDetails<NumberType> | undefined } | undefined)[]
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
          }
        }
      };
    })
  };
}

export function addBlankChallengeDetailsToCriteria(
  approvalCriteria?: iApprovalCriteria<bigint> | iIncomingApprovalCriteria<bigint> | iOutgoingApprovalCriteria<bigint>
) {
  if (!approvalCriteria) return approvalCriteria;

  return {
    ...approvalCriteria,
    merkleChallenges: addBlankChallengeDetails(approvalCriteria.merkleChallenges ?? [])
  };
}

export function addBlankChallengeDetails(merkleChallenges: Array<iMerkleChallenge<bigint>>) {
  return merkleChallenges.map((y) => {
    return {
      ...y,
      challengeInfoDetails: {
        challengeDetails: {
          leaves: [],
          isHashed: false
        }
      }
    };
  });
}
