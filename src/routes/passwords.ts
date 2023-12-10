import { BigIntify, GetCodeForPasswordRouteResponse, NumberType, PasswordDoc, convertPasswordDoc } from "bitbadgesjs-utils";
import CryptoJS from "crypto-js";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { MongoDB, PasswordModel } from "../db/db";

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

    const session = await MongoDB.startSession();
    session.startTransaction();

    try {

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
        await session.commitTransaction();
        await session.endSession();
        return res.status(200).send(response);
      }

      if (AES.decrypt(challengeDetails.password, process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) !== password) {
        throw new Error('Incorrect password');
      }


      await PasswordModel.findOneAndUpdate({ ...query, _legacyId: passwordDoc._legacyId }, { $inc: { "challengeDetails.currCode": 1 } }, { new: true, session }).lean().exec();
      const doc = await PasswordModel.findOne({ ...query, _legacyId: passwordDoc._legacyId }).lean().session(session).exec();
      if (!doc || !doc.challengeDetails || !doc.challengeDetails.currCode) {
        throw new Error('Error incrementing currCode');
      }

      const incrementedCode = BigInt(doc.challengeDetails.currCode);
      const userCode = incrementedCode - 1n; //The one we just incremented, so this is the code idx to give to the user
      const userCodeIdx = Number(userCode.toString());


      //add the user's cosmos address to the map
      const claimedUsersRes = await PasswordModel.findOneAndUpdate({
        ...query, _legacyId: passwordDoc._legacyId,
        [`claimedUsers.${req.session.cosmosAddress}`]: { $exists: false } //IMPORTANT: Prevents 
      }, { $set: { [`claimedUsers.${req.session.cosmosAddress}`]: userCode } }, { new: true, session }).lean().exec();
      if (!claimedUsersRes) {
        throw new Error('Error adding user to claimedUsers map');
      }

      const currCodeIdx = userCodeIdx;

      await session.commitTransaction();
      await session.endSession();

      return res.status(200).send({ code: AES.decrypt(challengeDetails.leavesDetails.preimages[currCodeIdx], process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) });
    } catch (e) {
      await session.abortTransaction();
      await session.endSession();
      throw e;
    }


  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting codes. " + e.message,
    });
  }
}
