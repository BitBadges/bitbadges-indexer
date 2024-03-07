import {
  type ErrorResponse,
  type iAddressList,
  type iGetOwnersForBadgeRouteSuccessResponse,
  type GetOwnersForBadgeRouteRequestBody,
  type NumberType
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { applyAddressListsToUserPermissions } from './balances';
import { getAddressListsFromDB } from './utils';
import { mustGetFromDB } from '../db/db';
import { BalanceModel } from '../db/schemas';
import { findInDB } from '../db/queries';

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
      // TODO: Support string-number queries
      throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
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

    return res.status(200).send({
      owners: ownersRes.map((balance) => {
        return {
          ...balance,
          incomingApprovals: balance.incomingApprovals.map((y) => {
            return {
              ...y,
              fromList: addressLists.find((list) => list.listId === y.fromListId) as iAddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as iAddressList
            };
          }),
          outgoingApprovals: balance.outgoingApprovals.map((y) => {
            return {
              ...y,
              toList: addressLists.find((list) => list.listId === y.toListId) as iAddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as iAddressList
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
      errorMessage: 'Error fetching owners for collection. Please try again later.'
    });
  }
};
