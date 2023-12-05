import { AddAddressToSurveyRouteRequestBody, AddAddressToSurveyRouteResponse, NumberType, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { ADDRESS_MAPPINGS_DB, insertToDB } from "../db/db";
import { serializeError } from "serialize-error";
import { catch404 } from "../utils/couchdb-utils";
import { AuthenticatedRequest, checkIfAuthenticated, returnUnauthorized } from "../blockin/blockin_handlers";

export const addAddressToSurvey = async (expressReq: Request, res: Response<AddAddressToSurveyRouteResponse>) => {
  try {
    const req = expressReq as any;
    const reqBody = req.body as AddAddressToSurveyRouteRequestBody;
    const address = reqBody.address;
    const mappingId = req.params.mappingId;

    const mappingDoc = await ADDRESS_MAPPINGS_DB.get(mappingId).catch(catch404);
    if (!mappingDoc) {
      throw new Error("No address mapping found for ID " + mappingId);
    }

    const editKey = reqBody.editKey;
    if (!mappingDoc.editKeys) {
      throw new Error("This address mapping is not editable. No edit keys found.");
    }

    const editKeyObj = mappingDoc.editKeys.find((key) => key.key === editKey);
    if (!editKeyObj) {
      throw new Error("Invalid edit key for address mapping.");
    }

    const expirationDate = new Date(Number(editKeyObj.expirationDate));
    if (expirationDate < new Date()) {
      throw new Error("Edit key has expired.");
    }

    const mustSignIn = editKeyObj.mustSignIn;
    if (mustSignIn) {
      const authReq = expressReq as AuthenticatedRequest<NumberType>;

      if (!checkIfAuthenticated(authReq)) return returnUnauthorized(res);

      const cosmosAddress = authReq.session.cosmosAddress;
      if (convertToCosmosAddress(address) !== cosmosAddress) {
        return res.status(403).send({
          error: `Address that you are attempting to add does not match your logged in address. For this edit key, you are required o be logged in to add addresses.`,
          message: "Address does not match logged in address."
        })
      }
    }

    await insertToDB(ADDRESS_MAPPINGS_DB, {
      ...mappingDoc,
      addresses: [...mappingDoc.addresses, convertToCosmosAddress(address)],
    });

    return res.status(200).send({});
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding address to survey. Please try again later."
    })
  }
}