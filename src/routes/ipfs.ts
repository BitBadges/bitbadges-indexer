import { AES } from "crypto-js";
import { Request, Response } from "express";
import { IPFS_TOTALS_DB, PASSWORDS_DB, insertToDB } from "../db/db";
import { addBalancesToIpfs, addClaimToIpfs, addMetadataToIpfs } from "../ipfs/ipfs";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { serializeError } from "serialize-error";
import { AddBalancesToIpfsRouteRequestBody, AddBalancesToIpfsRouteResponse, AddClaimToIpfsRouteRequestBody, AddClaimToIpfsRouteResponse, AddMetadataToIpfsRouteRequestBody, AddMetadataToIpfsRouteResponse, NumberType, convertIPFSTotalsDoc } from "bitbadgesjs-utils";
import { cleanBalances } from "../utils/dataCleaners";

const IPFS_UPLOAD_KB_LIMIT = 100000; //100MB

export const updateIpfsTotals = async (address: string, size: number, req: AuthenticatedRequest) => {
  let ipfsTotalsDoc = undefined;
  try {
    const _ipfsTotalsDoc = await IPFS_TOTALS_DB.get(address);
    ipfsTotalsDoc = convertIPFSTotalsDoc(_ipfsTotalsDoc, Number);
  } catch (e) {
    //ignore if non-404
    if (e.statusCode !== 404) {
      throw e;
    }
  }

  if (!ipfsTotalsDoc) {
    ipfsTotalsDoc = {
      _id: address,
      _rev: '',
      kbUploaded: size,
    }
  } else {
    ipfsTotalsDoc.kbUploaded += size;
  }

  await insertToDB(IPFS_TOTALS_DB, ipfsTotalsDoc);

  req.session.ipfsTotal = ipfsTotalsDoc.kbUploaded;
  req.session.save();
}

export const addBalancesToIpfsHandler = async (expressReq: Request, res: Response<AddBalancesToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest;
  const reqBody = req.body as AddBalancesToIpfsRouteRequestBody;

  if (req.session.ipfsTotal > IPFS_UPLOAD_KB_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    let result = undefined;
    let size = 0;
    if (reqBody.balances) {
      const balances = cleanBalances(reqBody.balances);
      result = await addBalancesToIpfs(balances);
      //get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body)) / 1000;
    }

    if (!result) {
      throw new Error('No addAll result received');
    }

    await updateIpfsTotals(req.session.cosmosAddress, size, req);

    return res.status(200).send({ result });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding balances to IPFS. Please try again later."
    })
  }
}

export const addMetadataToIpfsHandler = async (expressReq: Request, res: Response<AddMetadataToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest;
  const reqBody = req.body as AddMetadataToIpfsRouteRequestBody;

  if (req.session.ipfsTotal > IPFS_UPLOAD_KB_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    let size = 0;
    const { allResults, collectionMetadataResult, badgeMetadataResults } = await addMetadataToIpfs(reqBody.collectionMetadata, reqBody.badgeMetadata);
    //get size of req.body in KB
    size = Buffer.byteLength(JSON.stringify(req.body)) / 1000;

    if (allResults.length === 0) {
      throw new Error('No result received');
    }

    await updateIpfsTotals(req.session.cosmosAddress, size, req);

    return res.status(200).send({ allResults, collectionMetadataResult, badgeMetadataResults });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding metadata. Please try again later."
    })
  }
}

export const addClaimToIpfsHandler = async (expressReq: Request, res: Response<AddClaimToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest;
  const reqBody = req.body as AddClaimToIpfsRouteRequestBody;

  if (req.session.ipfsTotal > IPFS_UPLOAD_KB_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    const result = await addClaimToIpfs(reqBody.name, reqBody.description, [reqBody.leavesDetails], reqBody.password ? true : false);
    if (!result) {
      throw new Error('No addAll result received');
    }


    const { path, cid } = result;
    const password = reqBody.password;

    const SYM_KEY = process.env.SYM_KEY;

    await insertToDB(PASSWORDS_DB, {
      collectionId: "-1",
      claimId: "-1",
      challengeId: "-1",
      docClaimedByCollection: false,
      cid: cid.toString(),
      //Hash + Salt Password
      password: password ? AES.encrypt(password, SYM_KEY).toString() : "",
      //Symmmetric Key Encrypted with Hash + Salt Password
      codes: reqBody.leavesDetails.leaves.map((code: string) => AES.encrypt(code, SYM_KEY).toString()),
      isHashed: reqBody.leavesDetails.isHashed,
      currCode: "0",
      claimedUsers: {}
    });

    let size = Buffer.byteLength(JSON.stringify(req.body)) / 1000;
    await updateIpfsTotals(req.session.cosmosAddress, size, req);

    return res.status(200).send({ result: { cid: cid.toString(), path } });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding claim details to IPFS. Please try again later."
    })
  }
}