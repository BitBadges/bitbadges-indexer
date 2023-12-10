import axios from "axios";
import { FetchMetadataDirectlyRouteRequestBody, FetchMetadataDirectlyRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { FetchModel, getFromDB } from "../db/db";
import { getFromIpfs } from "../ipfs/ipfs";


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
          //If we are here, we need to fetch from the source
          if (uri.startsWith('ipfs://')) {
            const _res: any = await getFromIpfs(uri.replace('ipfs://', ''));
            metadataRes = JSON.parse(_res.file);
          } else {
            const _res = await axios.get(uri).then((res) => res.data);
            metadataRes = _res
          }
        } else {
          metadataRes = fetchDoc.content;
        }

        return metadataRes;
      });
    }

    const results = await Promise.all(promises.map(p => p()));

    return res.status(200).send({ metadata: results });
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
}