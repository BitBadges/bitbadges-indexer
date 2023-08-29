import { AddBalancesToIpfsRouteRequestBody, AddBalancesToIpfsRouteResponse, AddMerkleChallengeToIpfsRouteRequestBody, AddMerkleChallengeToIpfsRouteResponse, AddMetadataToIpfsRouteRequestBody, AddMetadataToIpfsRouteResponse, BigIntify, NumberType, convertChallengeDetails, convertIPFSTotalsDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { IPFS_TOTALS_DB, PASSWORDS_DB, insertToDB } from "../db/db";
import { addBalancesToIpfs, addMerkleChallengeToIpfs, addMetadataToIpfs } from "../ipfs/ipfs";
import { cleanBalances } from "../utils/dataCleaners";
import CryptoJS from "crypto-js";
import { catch404 } from "../utils/couchdb-utils";

const { AES } = CryptoJS;

const IPFS_UPLOAD_BYTES_LIMIT = 100000000; //100MB

export const updateIpfsTotals = async (address: string, size: number, req: AuthenticatedRequest<NumberType>) => {
  const _ipfsTotalsDoc = await IPFS_TOTALS_DB.get(address).catch(catch404);
  let ipfsTotalsDoc = _ipfsTotalsDoc ? {
    ...convertIPFSTotalsDoc(_ipfsTotalsDoc, Number),
    bytesUploaded: Number(_ipfsTotalsDoc.bytesUploaded) + size,
  } : {
    _id: address,
    _rev: undefined,
    bytesUploaded: size,
  };

  await insertToDB(IPFS_TOTALS_DB, ipfsTotalsDoc);

  req.session.ipfsTotal = ipfsTotalsDoc.bytesUploaded;
  req.session.save();
}

export const addBalancesToIpfsHandler = async (expressReq: Request, res: Response<AddBalancesToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddBalancesToIpfsRouteRequestBody;



  try {
    let result = undefined;
    let size = 0;
    if (reqBody.balances) {
      //get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      if (req.session.ipfsTotal + size > IPFS_UPLOAD_BYTES_LIMIT) {
        return res.status(400).send({ message: `This upload will cause you to exceed your IPFS storage limit. You have ${IPFS_UPLOAD_BYTES_LIMIT - req.session.ipfsTotal} bytes remaining.` });
      }

      const balances = cleanBalances(reqBody.balances);
      result = await addBalancesToIpfs(balances);
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
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddMetadataToIpfsRouteRequestBody;

  try {
    let size = Buffer.byteLength(JSON.stringify(req.body));

    if (req.session.ipfsTotal + size > IPFS_UPLOAD_BYTES_LIMIT) {
      return res.status(400).send({ message: `This upload will cause you to exceed your IPFS storage limit. You have ${IPFS_UPLOAD_BYTES_LIMIT - req.session.ipfsTotal} bytes remaining.` });
    }

    const { allResults, collectionMetadataResult, badgeMetadataResults } = await addMetadataToIpfs(reqBody.collectionMetadata, reqBody.badgeMetadata);

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
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddMerkleChallengeToIpfsRouteRequestBody;

  try {
    const challengeDetails = reqBody.challengeDetails ? convertChallengeDetails(reqBody.challengeDetails, BigIntify) : undefined;
    const size = Buffer.byteLength(JSON.stringify(req.body));

    if (req.session.ipfsTotal + size > IPFS_UPLOAD_BYTES_LIMIT) {
      return res.status(400).send({ message: `This upload will cause you to exceed your IPFS storage limit. You have ${IPFS_UPLOAD_BYTES_LIMIT - req.session.ipfsTotal} bytes remaining.` });
    }

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
      docClaimedByCollection: false,
      cid: cid.toString(),
      claimedUsers: {},
      challengeDetails: challengeDetails ? {
        ...challengeDetails,
        password: challengeDetails.password ? AES.encrypt(challengeDetails.password, SYM_KEY).toString() : "",
        leavesDetails: {
          ...challengeDetails.leavesDetails,
          preimages: challengeDetails.leavesDetails.preimages ? challengeDetails.leavesDetails.preimages.map((preimage: string) => AES.encrypt(preimage, SYM_KEY).toString()) : undefined
        }
      } : undefined
    });


    await updateIpfsTotals(req.session.cosmosAddress, size, req);

    return res.status(200).send({ result: { cid: cid.toString() } });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error adding claim details to IPFS. Please try again later."
    })
  }
}