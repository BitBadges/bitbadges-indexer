import { GetAddressMappingsRouteRequestBody, GetAddressMappingsRouteResponse, NumberType, getReservedAddressMapping } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { ADDRESS_MAPPINGS_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

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


    const fetchRes = await ADDRESS_MAPPINGS_DB.fetch({ keys: mappingIds });
    const docs = getDocsFromNanoFetchRes(fetchRes);


    return res.status(200).send({ addressMappings: [...docs.map(x => removeCouchDBDetails(x)), ...reservedAddressMappings] });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address mappings. Please try again later."
    })
  }
}
