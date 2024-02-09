import { FetchMetadataDirectlyRouteRequestBody, FetchMetadataDirectlyRouteResponse, NumberType } from "bitbadgesjs-sdk";
import { Request, Response } from "express";
import { fetchUriFromSource } from "../queue";
import { FetchModel, getFromDB } from "../db/db";


export const fetchMetadataDirectly = async (req: Request, res: Response<FetchMetadataDirectlyRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as FetchMetadataDirectlyRouteRequestBody;
    let uris = reqBody.uris;

    if (uris.length > 100) {
      throw new Error("You can only fetch up to 100 metadata at a time.");
    }

    const promises = [];
    for (const uri of uris) {
      promises.push(async () => {
        let metadataRes: any;
        const fetchDoc = await getFromDB(FetchModel, uri);

        if (!fetchDoc) {
          metadataRes = await fetchUriFromSource(uri);
        } else {
          metadataRes = fetchDoc.content;
        }

        return metadataRes;
      });
    }

    const results = await Promise.all(promises.map(p => p()));

    return res.status(200).send({ metadata: results });
  } catch (e) {
    return res.status(500).send({ errorMessage: e.message });
  }
}