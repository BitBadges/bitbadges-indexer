import { DeleteAddressMappingsRouteResponse, GetAddressMappingsRouteRequestBody, GetAddressMappingsRouteResponse, NumberType, UpdateAddressMappingsRouteRequestBody, UpdateAddressMappingsRouteResponse } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { ADDRESS_MAPPINGS_DB } from "../db/db";
import { getStatus } from "../db/status";
import { catch404, getDocsFromNanoFetchRes } from "../utils/couchdb-utils";
import { getAddressMappingsFromDB } from "./utils";

export const deleteAddressMappings = async (expressReq: Request, res: Response<DeleteAddressMappingsRouteResponse<bigint>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetAddressMappingsRouteRequestBody;
    const mappingIds = reqBody.mappingIds;

    const docs = await ADDRESS_MAPPINGS_DB.fetch({ keys: mappingIds });
    const docsToDelete = getDocsFromNanoFetchRes(docs);

    for (const doc of docsToDelete) {
      if (doc.createdBy !== req.session.cosmosAddress) {
        throw new Error("You are not the owner of mapping with ID " + doc._id);
      }
    }

    await ADDRESS_MAPPINGS_DB.bulk({
      docs: docsToDelete.map(x => {
        return {
          ...x,
          _deleted: true,
        }
      })
    });

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
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as UpdateAddressMappingsRouteRequestBody;
    const mappings = reqBody.addressMappings;
    const cosmosAddress = req.session.cosmosAddress

    for (const mapping of mappings) {
      if (!mapping.mappingId.startsWith('off-chain_')) {
        throw new Error("Mapping ID must start with off-chain_ (e.g. off-chain_MyMappingID)");
      }
    }

    const status = await getStatus();
    const docs = [];
    for (const mapping of mappings) {
      const existingDoc = await ADDRESS_MAPPINGS_DB.get(mapping.mappingId).catch(catch404);
      if (existingDoc) {
        if (existingDoc.createdBy !== cosmosAddress) {
          throw new Error("You are not the owner of mapping with ID " + mapping.mappingId);
        }

        docs.push({
          ...existingDoc,
          ...mapping,
        })
      } else {
        docs.push({
          ...mapping,
          createdBy: cosmosAddress,
          createdBlock: status.block.height,
          createdTimestamp: status.block.timestamp,
          _id: mapping.mappingId,
        });
      }
    }

    await ADDRESS_MAPPINGS_DB.bulk({
      docs: docs
    });

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

    const docs = await getAddressMappingsFromDB(mappingIds.map(x => { return { mappingId: x } }), true, reqBody.managerAddress);

    return res.status(200).send({ addressMappings: docs });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
