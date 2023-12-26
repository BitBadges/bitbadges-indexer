import { JSPrimitiveNumberType, Stringify } from "bitbadgesjs-proto";
import { AddressMappingDoc, DeleteAddressMappingsRouteResponse, GetAddressMappingsRouteRequestBody, GetAddressMappingsRouteResponse, ListActivityDoc, NumberType, UpdateAddressMappingsRouteRequestBody, UpdateAddressMappingsRouteResponse, convertAddressMappingDoc, convertAddressMappingEditKey, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfAuthenticated, returnUnauthorized } from "../blockin/blockin_handlers";
import { AddressMappingModel, ListActivityModel, deleteMany, getFromDB, insertMany, mustGetManyFromDB } from "../db/db";
import { getStatus } from "../db/status";
import { getAddressMappingsFromDB } from "./utils";
import crypto from 'crypto';

export const deleteAddressMappings = async (expressReq: Request, res: Response<DeleteAddressMappingsRouteResponse<bigint>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetAddressMappingsRouteRequestBody;
    const mappingIds = reqBody.mappingIds;

    if (mappingIds.length > 100) {
      throw new Error("You can only delete up to 100 address mappings at a time.");
    }

    const docsToDelete = await mustGetManyFromDB(AddressMappingModel, mappingIds);
    for (const doc of docsToDelete) {
      if (doc.createdBy !== req.session.cosmosAddress) {
        throw new Error("You are not the owner of mapping with ID " + doc._legacyId);
      }

      if (!doc.mappingId.includes("_")) {
        throw new Error("You cannot delete a mapping that was created on-chain.");
      }
    }

    await deleteMany(AddressMappingModel, docsToDelete.map(x => x._legacyId));

    return res.status(200).send({})
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error deleting address mappings. Please try again later."
    })
  }
}


export const updateAddressMappings = async (expressReq: Request, res: Response<UpdateAddressMappingsRouteResponse<bigint>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<JSPrimitiveNumberType>;
    const reqBody = req.body as UpdateAddressMappingsRouteRequestBody<JSPrimitiveNumberType>;
    const mappings = reqBody.addressMappings;
    const cosmosAddress = req.session.cosmosAddress;

    if (mappings.length > 100) {
      throw new Error("You can only update up to 100 address mappings at a time.");
    }

    for (const mapping of mappings) {
      const prefix = cosmosAddress + "_";
      if (!mapping.mappingId.startsWith(prefix)) {
        throw new Error("Mapping ID must start with " + prefix);
      }
    }

    const status = await getStatus();
    const docs: AddressMappingDoc<JSPrimitiveNumberType>[] = [];

    const activityDocs: ListActivityDoc<JSPrimitiveNumberType>[] = [];

    for (const mapping of mappings) {
      const _existingDoc = await getFromDB(AddressMappingModel, mapping.mappingId);

      if (_existingDoc) {
        const existingDoc = convertAddressMappingDoc(_existingDoc, Stringify);
        if (existingDoc.createdBy !== cosmosAddress) {
          throw new Error("You are not the owner of mapping with ID " + mapping.mappingId);
        }

        if (existingDoc.includeAddresses !== mapping.includeAddresses) {
          throw new Error("You cannot change from a whitelist to a blacklist or vice versa.");
        }

        docs.push({
          ...existingDoc,
          ...mapping,
          editKeys: mapping.editKeys ? mapping.editKeys.map(x => convertAddressMappingEditKey(x, Stringify)) : existingDoc.editKeys,
          addresses: mapping.addresses.map(x => convertToCosmosAddress(x)),
          updateHistory: [...existingDoc.updateHistory, {
            block: status.block.height,
            blockTimestamp: status.block.timestamp,
            txHash: '',
          }],
          lastUpdated: status.block.timestamp,
        })

        //we really have three statuses: include, excluded, and deleted
        if (existingDoc.includeAddresses !== mapping.includeAddresses) {
          const newAddressesNotInOld = mapping.addresses.filter(x => !existingDoc.addresses.includes(x));
          const oldAddressesNotInNew = existingDoc.addresses.filter(x => !mapping.addresses.includes(x));

          if (newAddressesNotInOld.length > 0) {
            activityDocs.push({
              _legacyId: crypto.randomBytes(16).toString('hex'),
              method: 'ListUpdate',
              addresses: newAddressesNotInOld.map(x => convertToCosmosAddress(x)),
              onList: true,
              mappingId: mapping.mappingId,
              timestamp: Date.now(),
              block: status?.block.height ?? 0n,
            })
          }

          if (oldAddressesNotInNew.length > 0) {
            activityDocs.push({
              _legacyId: crypto.randomBytes(16).toString('hex'),
              method: 'ListUpdate',
              addresses: oldAddressesNotInNew.map(x => convertToCosmosAddress(x)),
              onList: false,
              mappingId: mapping.mappingId,
              timestamp: Date.now(),
              block: status?.block.height ?? 0n,
            })
          }
        }

      } else {
        docs.push({
          ...mapping,
          editKeys: mapping.editKeys ? mapping.editKeys.map(x => convertAddressMappingEditKey(x, Stringify)) : undefined,
          addresses: mapping.addresses.map(x => convertToCosmosAddress(x)),
          createdBy: cosmosAddress,
          updateHistory: [{
            block: status.block.height,
            blockTimestamp: status.block.timestamp,
            txHash: '',
          }],
          _legacyId: mapping.mappingId,
          createdBlock: status.block.height,
          lastUpdated: status.block.timestamp,
        });

        activityDocs.push({
          _legacyId: crypto.randomBytes(16).toString('hex'),
          method: 'ListUpdate',
          addresses: mapping.addresses.map(x => convertToCosmosAddress(x)),
          onList: true,
          mappingId: mapping.mappingId,
          timestamp: Date.now(),
          block: status?.block.height ?? 0n,
        })
      }
    }

    await insertMany(AddressMappingModel, docs);
    await insertMany(ListActivityModel, activityDocs);

    return res.status(200).send({})
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error creating address mappings. Please try again later."
    })
  }
}

export const getAddressMappings = async (req: Request, res: Response<GetAddressMappingsRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetAddressMappingsRouteRequestBody;
    let mappingIds = reqBody.mappingIds;

    if (mappingIds.length > 100) {
      throw new Error("You can only fetch up to 100 address mappings at a time.");
    }

    const docs = await getAddressMappingsFromDB(mappingIds.map(x => { return { mappingId: x } }), true);

    const hasPrivateMapping = docs.find(x => x.private);
    if (hasPrivateMapping) {
      const authReq = req as AuthenticatedRequest<NumberType>;

      if (!checkIfAuthenticated(authReq)) return returnUnauthorized(res);

      const cosmosAddress = authReq.session.cosmosAddress;
      if (docs.some(x => x.private && x.createdBy !== cosmosAddress)) {
        return res.status(401).send({
          message: `Your signed in address ${authReq.session.address} does not have permission to view one or more of the requested address mappings.`
        })
      }
    }

    return res.status(200).send({ addressMappings: docs });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
