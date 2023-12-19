import { BigIntify, GetCodeForPasswordRouteResponse, NumberType, PasswordDoc, convertPasswordDoc } from "bitbadgesjs-utils";
import CryptoJS from "crypto-js";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { PasswordModel } from "../db/db";

const { AES } = CryptoJS;


export const getMerkleChallengeCodeViaPassword = async (expressReq: Request, res: Response<GetCodeForPasswordRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    if (!req.session.blockin || !req.session.cosmosAddress) {
      return Promise.reject({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
    }

    const collectionId = req.params.collectionId;
    const cid = req.params.cid;
    const password = req.params.password;

    const query = {
      collectionId: Number(collectionId),
      cid: cid,
      docClaimedByCollection: true,
    };
    const passwordDocResponse = await PasswordModel.find(query).lean().exec();
    if (passwordDocResponse.length === 0) {
      throw new Error('No password doc found');
    }

    const passwordDoc = convertPasswordDoc(passwordDocResponse[0] as PasswordDoc<NumberType>, BigIntify);
    const challengeDetails = passwordDoc.challengeDetails;
    const claimedUsers = passwordDoc.claimedUsers ? passwordDoc.claimedUsers : {};
    if (!challengeDetails || !challengeDetails?.leavesDetails.preimages || !challengeDetails.password) {
      throw new Error('Invalid challengeDetails');
    }

    //Already claimed
    if (claimedUsers[req.session.cosmosAddress] >= 0) {
      const idx = Number(claimedUsers[req.session.cosmosAddress].toString());
      const response = { code: AES.decrypt(challengeDetails.leavesDetails.preimages[idx], process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) };
      return res.status(200).send(response);
    }

    if (AES.decrypt(challengeDetails.password, process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) !== password) {
      throw new Error('Incorrect password');
    }

    //Find the doc, increment currCode, and add the given code idx to claimedUsers
    const doc = await PasswordModel.findOneAndUpdate({
      ...query, _legacyId: passwordDoc._legacyId,
      [`claimedUsers.${req.session.cosmosAddress}`]: { $exists: false }
    },
      [
        {
          $set: {
            "challengeDetails.currCode": { "$add": ["$challengeDetails.currCode", 1] },
          }
        },
        {
          $set: {
            [`claimedUsers.${req.session.cosmosAddress}`]: { "$subtract": ["$challengeDetails.currCode", 1] },
          }
        }
      ], { new: true }).lean().exec();
    if (!doc || !doc.challengeDetails || !doc.challengeDetails.currCode) {
      throw new Error('Error incrementing currCode');
    }

    const currCodeIdx = Number(doc.claimedUsers[req.session.cosmosAddress]);
    return res.status(200).send({ code: AES.decrypt(challengeDetails.leavesDetails.preimages[currCodeIdx], process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) });

  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting codes. " + e.message,
    });
  }
}
