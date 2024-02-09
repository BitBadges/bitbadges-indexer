import { AddApprovalDetailsToOffChainStorageRouteRequestBody, AddApprovalDetailsToOffChainStorageRouteResponse, AddBalancesToOffChainStorageRouteRequestBody, AddBalancesToOffChainStorageRouteResponse, AddMetadataToIpfsRouteRequestBody, AddMetadataToIpfsRouteResponse, BigIntify, NumberType, convertChallengeDetails, convertIPFSTotalsDoc } from "bitbadgesjs-sdk";
import CryptoJS from "crypto-js";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfManager } from "../blockin/blockin_handlers";
import { CollectionModel, IPFSTotalsModel, PasswordModel, getFromDB, insertToDB, mustGetFromDB } from "../db/db";
import { addApprovalDetailsToOffChainStorage, addBalancesToOffChainStorage, addMetadataToIpfs } from "../ipfs/ipfs";
import { cleanBalanceMap } from "../utils/dataCleaners";
import { refreshCollection } from "./refresh";
import mongoose from "mongoose";

const { AES } = CryptoJS;

const IPFS_UPLOAD_BYTES_LIMIT = 1000000000; //1GB

//will throw error if limit exceeded
export const checkIpfsTotals = async (address: string, size: number) => {
  await updateIpfsTotals(address, size, true);
}

export const updateIpfsTotals = async (address: string, size: number, doNotInsert?: boolean) => {
  const _ipfsTotalsDoc = await getFromDB(IPFSTotalsModel, address);
  let ipfsTotalsDoc = _ipfsTotalsDoc ? {
    ...convertIPFSTotalsDoc(_ipfsTotalsDoc, Number),
    bytesUploaded: Number(_ipfsTotalsDoc.bytesUploaded) + size,
  } : {
    _docId: address,
    _rev: undefined,
    bytesUploaded: size,
  };

  if (ipfsTotalsDoc.bytesUploaded > IPFS_UPLOAD_BYTES_LIMIT) {
    throw new Error('You have exceeded your IPFS storage limit.');
  }

  if (!doNotInsert) await insertToDB(IPFSTotalsModel, ipfsTotalsDoc);
}

export const addBalancesToOffChainStorageHandler = async (expressReq: Request, res: Response<AddBalancesToOffChainStorageRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddBalancesToOffChainStorageRouteRequestBody;

  try {
    //Do I really need to check manager? Only manager can update the on-chain URL
    if (BigInt(reqBody.collectionId) > 0) {
      const managerCheck = checkIfManager(req, reqBody.collectionId);
      if (!managerCheck) throw new Error('You are not the manager of this collection');
    }

    let result = undefined;
    let size = 0;
    if (reqBody.balances) {
      //get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      let urlPath = undefined;

      //I think this is safe assuming we only allow updates to the Digital Ocean spaces from this function
      if (BigInt(reqBody.collectionId) > 0) {
        //Get existing urlPath
        const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
        if (collectionDoc.offChainBalancesMetadataTimeline.length > 0) {
          urlPath = collectionDoc.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.split('/').pop();
        }
      }
      const balances = cleanBalanceMap(reqBody.balances);
      result = await addBalancesToOffChainStorage(balances, reqBody.method, reqBody.collectionId, urlPath);
      if (!result) {
        throw new Error('No add result received');
      }

      await updateIpfsTotals(req.session.cosmosAddress, size);
      if (BigInt(reqBody.collectionId) > 0) await refreshCollection(reqBody.collectionId.toString(), true);


      return res.status(200).send({ uri: result.uri, result: result });
    } else {
      throw new Error('No balances provided');
    }

  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error adding balances to storage."
    })
  }
}

export const addMetadataToIpfsHandler = async (expressReq: Request, res: Response<AddMetadataToIpfsRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddMetadataToIpfsRouteRequestBody;

  try {
    let size = Buffer.byteLength(JSON.stringify(req.body));

    await checkIpfsTotals(req.session.cosmosAddress, size);

    const { allResults, collectionMetadataResult, badgeMetadataResults } = await addMetadataToIpfs(reqBody.collectionMetadata, reqBody.badgeMetadata);

    if (allResults.length === 0) {
      throw new Error('No result received');
    }

    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send({ allResults, collectionMetadataResult, badgeMetadataResults });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error adding metadata. Please try again later."
    })
  }
}

export const addApprovalDetailsToOffChainStorageHandler = async (expressReq: Request, res: Response<AddApprovalDetailsToOffChainStorageRouteResponse<NumberType>>) => {
  const req = expressReq as AuthenticatedRequest<NumberType>;
  const reqBody = req.body as AddApprovalDetailsToOffChainStorageRouteRequestBody;

  try {
    const challengeDetails = reqBody.challengeDetails ? convertChallengeDetails(reqBody.challengeDetails, BigIntify) : undefined;
    const size = Buffer.byteLength(JSON.stringify(req.body));

    await checkIpfsTotals(req.session.cosmosAddress, size);

    const result = await addApprovalDetailsToOffChainStorage(reqBody.name, reqBody.description, challengeDetails);
    if (!result) {
      throw new Error('No addAll result received');
    }

    const { cid } = result;

    const duplicateCheckRes = await PasswordModel.find({
      createdBy: req.session.cosmosAddress,
      challengeLevel: "collection",
      cid: cid.toString()
    }).lean().exec();

    if (duplicateCheckRes.length > 0) {
      return res.status(400).send({ errorMessage: 'You have already added a challenge with an equivalent CID to IPFS. We do not allow duplicate CIDs.' });
    }

    const SYM_KEY = process.env.SYM_KEY;

    await insertToDB(PasswordModel, {
      _docId: new mongoose.Types.ObjectId().toString(),
      createdBy: req.session.cosmosAddress,
      challengeLevel: "collection",
      collectionId: "-1",
      docClaimedByCollection: false,
      cid: cid.toString(),
      claimedUsers: {},
      challengeDetails: challengeDetails ? {
        ...challengeDetails,
        currCode: "0",
        password: challengeDetails.password ? AES.encrypt(challengeDetails.password, SYM_KEY).toString() : "",
        leavesDetails: {
          ...challengeDetails.leavesDetails,
          preimages: challengeDetails.leavesDetails.preimages ? challengeDetails.leavesDetails.preimages.map((preimage: string) => AES.encrypt(preimage, SYM_KEY).toString()) : undefined
        }
      } : undefined
    });


    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send({ result: { cid: cid.toString() } });
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error adding claim details to IPFS. Please try again later."
    })
  }
}