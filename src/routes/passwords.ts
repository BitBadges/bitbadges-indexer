import { Mutex } from "async-mutex";
import { BigIntify, GetCodeForPasswordRouteResponse, NumberType, convertPasswordDoc } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import nano from "nano";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { PASSWORDS_DB, insertToDB } from "../db/db";
import CryptoJS from "crypto-js";

const { AES } = CryptoJS;

// create a map to store the document-specific mutexes
const documentMutexes = new Map();
const MAX_MUTEXES = 1000; // maximum number of mutexes to keep in the map

// create a mutex to protect the documentMutexes map
const documentMutexesMutex = new Mutex();

//TODO: In the future, we should probably look to change this approach to a more scalable and high throughput approach  
//This is a simple approach that will work 99% of the time for now
export const getMerkleChallengeCodeViaPassword = async (expressReq: Request, res: Response<GetCodeForPasswordRouteResponse<NumberType>>) => {
  try {
    let documentMutex: Mutex | undefined = undefined;
    // acquire the mutex for the documentMutexes map
    await documentMutexesMutex.runExclusive(async () => {
      const cid = expressReq.params.cid;
      // get or create the mutex for this document ID
      documentMutex = documentMutexes.get(cid);
      if (!documentMutex) {
        // check if we need to prune the map
        if (documentMutexes.size >= MAX_MUTEXES) {
          // remove the least recently used mutex
          const oldestId = documentMutexes.keys().next().value;
          documentMutexes.delete(oldestId);
        }

        documentMutex = new Mutex();
        documentMutexes.set(cid, documentMutex);
      }
    });

    //For TypeScript to be happy
    if (!documentMutex) {
      documentMutex = new Mutex();
    }


    const returnValue = await documentMutex.runExclusive(async () => {
      const req = expressReq as AuthenticatedRequest<NumberType>;
      if (!req.session.blockin || !req.session.cosmosAddress) {
        return Promise.reject({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
      }

      const collectionId = req.params.collectionId;
      const cid = req.params.cid;
      const password = req.params.password;

      const query: nano.MangoQuery = {
        selector: {
          collectionId: {
            "$eq": Number(collectionId)
          },
          cid: {
            "$eq": cid
          },
          docClaimedByCollection: {
            "$eq": true
          },
        }
      }
      const passwordDocResponse = await PASSWORDS_DB.find(query);

      if (passwordDocResponse.docs.length === 0) {
        return Promise.reject({ message: 'Doc not found' });
      }

      const passwordDoc = convertPasswordDoc(passwordDocResponse.docs[0], BigIntify);

      const challengeDetails = passwordDoc.challengeDetails;

      const currCode = challengeDetails?.currCode ? challengeDetails.currCode : 0n;
      const claimedUsers = passwordDoc.claimedUsers ? passwordDoc.claimedUsers : {};

      if (!challengeDetails || !challengeDetails?.leavesDetails.preimages || !challengeDetails.password) {
        return Promise.reject({ message: 'No codes found' });
      }

      //Already claimed
      if (claimedUsers[req.session.cosmosAddress] >= 0) {
        const idx = Number(claimedUsers[req.session.cosmosAddress].toString());
        return { code: AES.decrypt(challengeDetails.leavesDetails.preimages[idx], process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) };
      }

      if (
        AES.decrypt(challengeDetails.password, process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) !== password
      ) {
        return Promise.reject({ message: 'Incorrect password' });
      }

      challengeDetails.currCode = challengeDetails.currCode ? challengeDetails.currCode + 1n : 1n;

      passwordDoc.claimedUsers = {
        ...passwordDoc.claimedUsers,
        [req.session.cosmosAddress]: currCode
      }

      await insertToDB(PASSWORDS_DB, {
        ...passwordDoc,
      });

      const currCodeIdx = Number(currCode.toString());
      return { code: AES.decrypt(challengeDetails.leavesDetails.preimages[currCodeIdx], process.env.SYM_KEY).toString(CryptoJS.enc.Utf8) };
    });

    return res.status(200).send(returnValue);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting codes. Please try again later. " + e.message,
    });
  }
}
