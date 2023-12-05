import { AddAddressToSurveyRouteRequestBody, AddAddressToSurveyRouteResponse, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { ADDRESS_MAPPINGS_DB, insertToDB } from "../db/db";
import { serializeError } from "serialize-error";
import { catch404 } from "../utils/couchdb-utils";

export const addAddressToSurvey = async (expressReq: Request, res: Response<AddAddressToSurveyRouteResponse>) => {
  try {
    const req = expressReq as any;
    const reqBody = req.body as AddAddressToSurveyRouteRequestBody;
    const address = reqBody.address;
    const surveyId = req.params.surveyId;

    const mappingDoc = await ADDRESS_MAPPINGS_DB.get(surveyId).catch(catch404);
    if (!mappingDoc) {
      throw new Error("No address mapping found for survey ID " + surveyId);
    }

    if (!mappingDoc.surveyMode) {
      throw new Error("Survey ID " + surveyId + " is not a survey mapping.");
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