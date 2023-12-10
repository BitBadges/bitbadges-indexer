import { AddressMapping, NumberType, Stringify } from "bitbadgesjs-proto";
import { GetOwnersForBadgeRouteRequestBody, GetOwnersForBadgeRouteResponse, convertBalanceDoc } from "bitbadgesjs-utils";
import { Request, Response } from 'express';
import { serializeError } from "serialize-error";
import { BalanceModel, mustGetFromDB } from "../db/db";
import { applyAddressMappingsToUserPermissions } from "./balances";
import { getAddressMappingsFromDB } from "./utils";

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

    const numOwners = await BalanceModel.countDocuments({ collectionId: Number(req.params.collectionId) });

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





    let addressMappingIdsToFetch = [];
    for (const balanceDoc of ownersRes) {
      for (const incomingTransfer of balanceDoc.incomingApprovals) {
        addressMappingIdsToFetch.push(incomingTransfer.fromMappingId);
        addressMappingIdsToFetch.push(incomingTransfer.initiatedByMappingId);
      }


      for (const outgoingTransfer of balanceDoc.outgoingApprovals) {
        addressMappingIdsToFetch.push(outgoingTransfer.toMappingId);
        addressMappingIdsToFetch.push(outgoingTransfer.initiatedByMappingId);

      }

      for (const incomingTransfer of balanceDoc.userPermissions.canUpdateIncomingApprovals) {
        addressMappingIdsToFetch.push(incomingTransfer.fromMappingId);
        addressMappingIdsToFetch.push(incomingTransfer.initiatedByMappingId);
      }

      for (const outgoingTransfer of balanceDoc.userPermissions.canUpdateOutgoingApprovals) {
        addressMappingIdsToFetch.push(outgoingTransfer.toMappingId);
        addressMappingIdsToFetch.push(outgoingTransfer.initiatedByMappingId);
      }
    }

    addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

    const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch.map(x => { return { mappingId: x } }), false);

    return res.status(200).send({
      owners: ownersRes.map(doc => convertBalanceDoc(doc, Stringify)).map((balance) => {
        return {
          ...balance,
          incomingApprovals: balance.incomingApprovals.map(y => {
            return {
              ...y,
              fromMapping: addressMappings.find((mapping) => mapping.mappingId === y.fromMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
            }
          }),
          outgoingApprovals: balance.outgoingApprovals.map(y => {
            return {
              ...y,
              toMapping: addressMappings.find((mapping) => mapping.mappingId === y.toMappingId) as AddressMapping,
              initiatedByMapping: addressMappings.find((mapping) => mapping.mappingId === y.initiatedByMappingId) as AddressMapping,
            }
          }),
          userPermissions: applyAddressMappingsToUserPermissions(balance.userPermissions, addressMappings),
        }
      }),
      pagination: {
        bookmark: newBookmark.toString(),
        hasMore: ownersRes.length === 25,
        total: numOwners
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
