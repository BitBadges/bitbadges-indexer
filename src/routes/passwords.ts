import { Mutex } from "async-mutex";
import { Request, Response } from "express";
import nano from "nano";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { PASSWORDS_DB } from "../db/db";
import { convertFromPasswordDocument, convertToPasswordDocument } from "bitbadgesjs-utils";
import { AES } from "crypto-js";

// create a map to store the document-specific mutexes
const documentMutexes = new Map();
const MAX_MUTEXES = 1000; // maximum number of mutexes to keep in the map

// create a mutex to protect the documentMutexes map
const documentMutexesMutex = new Mutex();

//TODO: In the future, we should probably look to change this approach to a more scalable and high throughput approach
//This is a simple approach that will work 99% of the time for now
export const getPasswordsAndCodes = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest;
    if (!req.session.blockin || !req.session.cosmosAddress) {
      return res.status(401).send({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
    }

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
      const req = expressReq as AuthenticatedRequest;
      if (!req.session.blockin || !req.session.cosmosAddress) {
        return Promise.reject({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
      }

      const collectionId = req.params.id;
      const claimId = req.params.claimId;
      const password = req.params.password;

      //TODO: prune once all codes have actually been used or expired

      const query: nano.MangoQuery = {
        selector: {
          collectionId: {
            "$eq": collectionId
          },
          claimId: {
            "$eq": claimId
          }
        }
      }
      const passwordDocResponse = await PASSWORDS_DB.find(query);

      if (passwordDocResponse.docs.length === 0) {
        return Promise.reject({ message: 'Doc not found' });
      }

      const passwordDoc = convertToPasswordDocument(passwordDocResponse.docs[0]);

      const currCode = passwordDoc.currCode;
      const claimedUsers = passwordDoc.claimedUsers ? passwordDoc.claimedUsers : {};

      //Already claimed
      if (claimedUsers[req.session.cosmosAddress] >= 0) {
        const idx = Number(claimedUsers[req.session.cosmosAddress].toString());
        return { code: AES.decrypt(passwordDoc.codes[idx], process.env.SYM_KEY).toString() };
      }

      if (passwordDoc.password !== password) {
        return Promise.reject({ message: 'Incorrect password' });
      }

      await PASSWORDS_DB.insert(convertFromPasswordDocument({
        ...passwordDoc,
        currCode: passwordDoc.currCode + 1n,
        claimedUsers: {
          ...claimedUsers,
          [req.session.cosmosAddress]: currCode
        }
      }));

      const currCodeIdx = Number(currCode.toString());

      return { code: AES.decrypt(passwordDoc.codes[currCodeIdx], process.env.SYM_KEY).toString() };
    });

    console.log(returnValue);

    return res.status(200).send(returnValue);
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Internal server error handling passwords.' });
  }


}
