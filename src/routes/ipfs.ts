import { AddBalancesToIpfsRouteRequestBody, AddBalancesToIpfsRouteResponse, AddMerkleChallengeToIpfsRouteRequestBody, AddMerkleChallengeToIpfsRouteResponse, AddMetadataToIpfsRouteRequestBody, AddMetadataToIpfsRouteResponse, BigIntify, NumberType, convertChallengeDetails, convertIPFSTotalsDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { IPFS_TOTALS_DB, PASSWORDS_DB, insertToDB } from "../db/db";
import { addBalancesToIpfs, addMerkleChallengeToIpfs, addMetadataToIpfs } from "../ipfs/ipfs";
import { cleanBalances } from "../utils/dataCleaners";
import { AES } from "crypto-js";

const IPFS_UPLOAD_BYTES_LIMIT = 100000000; //100MB

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
      _rev: undefined,
      bytesUploaded: size,
    }
  } else {
    ipfsTotalsDoc.bytesUploaded += size;
  }

  await insertToDB(IPFS_TOTALS_DB, ipfsTotalsDoc);

  req.session.ipfsTotal = ipfsTotalsDoc.bytesUploaded;
  req.session.save();
}

export const addBalancesToIpfsHandler = async (expressReq: Request, res: Response<AddBalancesToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest;
  const reqBody = req.body as AddBalancesToIpfsRouteRequestBody;

  if (req.session.ipfsTotal > IPFS_UPLOAD_BYTES_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    let result = undefined;
    let size = 0;
    if (reqBody.balances) {
      const balances = cleanBalances(reqBody.balances);
      result = await addBalancesToIpfs(balances);
      //get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));
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

  if (req.session.ipfsTotal > IPFS_UPLOAD_BYTES_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    let size = 0;
    const { allResults, collectionMetadataResult, badgeMetadataResults } = await addMetadataToIpfs(reqBody.collectionMetadata, reqBody.badgeMetadata);
    //get size of req.body in KB
    size = Buffer.byteLength(JSON.stringify(req.body));

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

export const addMerkleChallengeToIpfsHandler = async (expressReq: Request, res: Response<AddMerkleChallengeToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest;
  const reqBody = req.body as AddMerkleChallengeToIpfsRouteRequestBody;

  if (req.session.ipfsTotal > IPFS_UPLOAD_BYTES_LIMIT) {
    return res.status(400).send({ message: 'You have exceeded your IPFS storage limit.' });
  }

  try {
    const challengeDetails = reqBody.challengeDetails ? convertChallengeDetails(reqBody.challengeDetails, BigIntify) : undefined;
    const result = await addMerkleChallengeToIpfs(reqBody.name, reqBody.description, challengeDetails);
    if (!result) {
      throw new Error('No addAll result received');
    }

    const { cid } = result;

    const duplicateCheckRes = await PASSWORDS_DB.find({
      selector: {
        createdBy: {
          "$eq": req.session.cosmosAddress
        },
        challengeLevel: {
          "$eq": "collection"
        },
        cid: {
          "$eq": cid.toString()
        }
      }
    });


    if (duplicateCheckRes.docs.length > 0) {
      return res.status(400).send({ message: 'You have already added a challenge with an equivalent CID to IPFS. We do not allow duplicate CIDs.' });
    }

    const SYM_KEY = process.env.SYM_KEY;

    await insertToDB(PASSWORDS_DB, {
      createdBy: req.session.cosmosAddress,
      challengeLevel: "collection",
      collectionId: "-1",
      // challengeId: "-1",
      docClaimedByCollection: false,
      cid: cid.toString(),
      claimedUsers: {},
      challengeDetails: challengeDetails ? {
        ...challengeDetails,
        password: challengeDetails.password ? AES.encrypt(challengeDetails.password, SYM_KEY).toString() : "",
        // password: challengeDetails.password ? challengeDetails.password : "",
        leavesDetails: {
          ...challengeDetails.leavesDetails,
          preimages: challengeDetails.leavesDetails.preimages ? challengeDetails.leavesDetails.preimages.map((preimage: string) => AES.encrypt(preimage, SYM_KEY).toString()) : undefined
          // preimages: challengeDetails.leavesDetails.preimages ? challengeDetails.leavesDetails.preimages : undefined
        }
      } : undefined
    });


    //   challengeDetails: challengeDetails.map(x => {
    //     return {
    //       ...x,
    //       password: x.password ? AES.encrypt(x.password, SYM_KEY).toString() : "",
    //       leavesDetails: {
    //         ...x.leavesDetails,
    //         preimages: x.leavesDetails.preimages ? x.leavesDetails.preimages.map((preimage: string) => AES.encrypt(preimage, SYM_KEY).toString()) : undefined
    //       }
    //     }
    //   })
    // });


    let size = Buffer.byteLength(JSON.stringify(req.body));
    await updateIpfsTotals(req.session.cosmosAddress, size, req);

    return res.status(200).send({ result: { cid: cid.toString() } });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding claim details to IPFS. Please try again later."
    })
  }
}