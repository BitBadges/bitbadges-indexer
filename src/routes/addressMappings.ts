import { UpdateAddressMappingsRouteRequestBody, UpdateAddressMappingsRouteResponse, GetAddressMappingsRouteRequestBody, GetAddressMappingsRouteResponse, NumberType, getReservedAddressMapping, DeleteAddressMappingsRouteResponse } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { ADDRESS_MAPPINGS_DB, FETCHES_DB } from "../db/db";
import { catch404, getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";
import { getStatus } from "../db/status";

export const deleteAddressMappings = async (req: Request, res: Response<DeleteAddressMappingsRouteResponse<bigint>>) => {
  try {
    const reqBody = req.body as GetAddressMappingsRouteRequestBody;
    const mappingIds = reqBody.mappingIds;

    const docs = await ADDRESS_MAPPINGS_DB.fetch({ keys: mappingIds });
    const docsToDelete = getDocsFromNanoFetchRes(docs);

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

    return res.status(200).send({
    })
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

    const reservedAddressMappings = [];

    for (const mappingId of mappingIds) {
      if (mappingId === "Manager" && !reqBody.managerAddress) return res.status(400).send({ message: "Must specify managerAddress in request, if you want to fetch the Manager mapping." });

      const mapping = getReservedAddressMapping(mappingId, reqBody.managerAddress ?? "");
      if (mapping) {
        reservedAddressMappings.push(mapping);
        mappingIds = mappingIds.filter(x => x !== mappingId);
      }
    }

    let docs: any[] = [];
    if (mappingIds.length > 0) {
      const fetchRes = await ADDRESS_MAPPINGS_DB.fetch({ keys: mappingIds });
      docs = getDocsFromNanoFetchRes(fetchRes);
    }

    let uris: string[] = docs.map(x => x.uri);
    if (uris.length > 0) {
      for (const uri of uris) {
        const doc = await FETCHES_DB.get(uri).catch(catch404);
        if (doc) {
          docs = docs.map(x => {
            if (x.uri === uri) {
              return {
                ...x,
                metadata: doc.content,
              }
            } else {
              return x;
            }
          })
        }
      }
    }


    return res.status(200).send({ addressMappings: [...docs.map(x => removeCouchDBDetails(x)), ...reservedAddressMappings] });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
