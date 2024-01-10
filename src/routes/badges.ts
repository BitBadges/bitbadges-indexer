import { AddressList, NumberType, Stringify } from "bitbadgesjs-proto";
import { GetOwnersForBadgeRouteRequestBody, GetOwnersForBadgeRouteResponse, convertBalanceDoc } from "bitbadgesjs-utils";
import { Request, Response } from 'express';
import { serializeError } from "serialize-error";
import { BalanceModel, mustGetFromDB } from "../db/db";
import { applyAddressListsToUserPermissions } from "./balances";
import { getAddressListsFromDB } from "./utils";

export const getOwnersForBadge = async (req: Request, res: Response<GetOwnersForBadgeRouteResponse<NumberType>>) => {
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
      //TODO: Support string-number queries
      throw new Error('This collection has so many badges that it exceeds the maximum safe integer for our database. Please contact us for support.');
    }

    const ownersRes = await BalanceModel.find({
      cosmosAddress: {
        //does not equal mint OR total
        "$nin": [
          "Mint",
          "Total"
        ]
      },
      collectionId: Number(req.params.collectionId),
      "balances": {
        "$elemMatch": {
          "badgeIds": {
            "$elemMatch": {
              "start": {
                "$lte": Number(req.params.badgeId),
                "$type": "number"
              },
              "end": {
                "$gte": Number(req.params.badgeId),
                "$type": "number"
              }
            }
          }
        }
      }
    }).limit(25).skip(reqBody.bookmark ? 25 * Number(reqBody.bookmark) : 0).lean().exec();

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

    const addressLists = await getAddressListsFromDB(addressListIdsToFetch.map(x => { return { listId: x } }), false);

    return res.status(200).send({
      owners: ownersRes.map(doc => convertBalanceDoc(doc, Stringify)).map((balance) => {
        return {
          ...balance,
          incomingApprovals: balance.incomingApprovals.map(y => {
            return {
              ...y,
              fromList: addressLists.find((list) => list.listId === y.fromListId) as AddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as AddressList,
            }
          }),
          outgoingApprovals: balance.outgoingApprovals.map(y => {
            return {
              ...y,
              toList: addressLists.find((list) => list.listId === y.toListId) as AddressList,
              initiatedByList: addressLists.find((list) => list.listId === y.initiatedByListId) as AddressList,
            }
          }),
          userPermissions: applyAddressListsToUserPermissions(balance.userPermissions, addressLists),
        }
      }),
      pagination: {
        bookmark: newBookmark.toString(),
        hasMore: ownersRes.length === 25
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: 'Error fetching owners for collection. Please try again later.'
    });
  }
}
