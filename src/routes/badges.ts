import { NumberType, Stringify, AddressMapping } from "bitbadgesjs-proto";
import { GetOwnersForBadgeRouteResponse, GetOwnersForBadgeRouteRequestBody, convertBalanceDoc } from "bitbadgesjs-utils";
import { serializeError } from "serialize-error";
import { BALANCES_DB } from "../db/db";
import { removeCouchDBDetails } from "../utils/couchdb-utils";
import { getAddressMappingsFromDB } from "./utils";
import { Response, Request } from 'express';
import { applyAddressMappingsToUserPermissions } from "./balances";

export const getOwnersForBadge = async (req: Request, res: Response<GetOwnersForBadgeRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetOwnersForBadgeRouteRequestBody;

    const totalSupplys = await BALANCES_DB.get(`${req.params.collectionId}:Total`);

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

    const ownersResOverview = await BALANCES_DB.partitionInfo(`${req.params.collectionId}`);
    const numOwners = ownersResOverview.doc_count;

    const ownersRes = await BALANCES_DB.partitionedFind(`${req.params.collectionId}`, {
      selector: {
        "cosmosAddress": {
          //does not equal mint OR total
          "$and": [
            {
              "$ne": "Mint",
            },
            {
              "$ne": "Total",
            }
          ]
        },
        "balances": {
          "$elemMatch": {
            "badgeIds": {
              "$elemMatch": {
                "$and": [
                  {
                    "start": {
                      "$and": [
                        {
                          "$lte": Number(req.params.badgeId),
                        },
                        {
                          "$type": "number"
                        }
                      ]
                    }
                  },
                  {
                    "end": {
                      "$and": [
                        {
                          "$gte": Number(req.params.badgeId),
                        },
                        {
                          "$type": "number"
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      bookmark: reqBody.bookmark ? reqBody.bookmark : undefined,
    });

    let addressMappingIdsToFetch = [];
    for (const balanceDoc of ownersRes.docs) {
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
      owners: ownersRes.docs.map(doc => convertBalanceDoc(doc, Stringify)).map(removeCouchDBDetails).map((balance) => {
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
        bookmark: ownersRes.bookmark || '',
        hasMore: ownersRes.docs.length === 25,
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
