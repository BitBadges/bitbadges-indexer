import { Request, Response } from "express";
import { AuthenticatedRequest } from "src/blockin/blockin_handlers";
import { PASSWORDS_DB } from "../db/db";
import { Mutex } from "async-mutex";

// create a map to store the document-specific mutexes
const documentMutexes = new Map();
const MAX_MUTEXES = 1000; // maximum number of mutexes to keep in the map

// create a mutex to protect the documentMutexes map
const documentMutexesMutex = new Mutex();

//In the future, we should probably look to change this approach to a more scalable and high throughput approach
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


        await documentMutex.runExclusive(async () => {
            const req = expressReq as AuthenticatedRequest;
            if (!req.session.blockin || !req.session.cosmosAddress) {
                return res.status(401).send({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
            }

            const cid = req.params.cid;
            const password = req.params.password;

            //TODO: prune once all codes have actually been used or expired

            const passwordDoc = await PASSWORDS_DB.get(cid);
            const currCode = passwordDoc.currCode;
            const claimedUsers = passwordDoc.claimedUsers ? passwordDoc.claimedUsers : {};

            if (claimedUsers[req.session.cosmosAddress]) {
                return res.status(200).send({ code: passwordDoc.codes[claimedUsers[req.session.cosmosAddress]] });
            }

            if (!passwordDoc) {
                return res.status(404).send({ message: 'Doc not found' });
            }

            if (passwordDoc.password !== password) {
                return res.status(401).send({ message: 'Incorrect password' });
            }

            await PASSWORDS_DB.insert({
                ...passwordDoc,
                currCode: passwordDoc.currCode + 1,
                claimedUsers: {
                    ...claimedUsers,
                    [req.session.cosmosAddress]: currCode
                }
            });

            return res.status(200).send({ code: passwordDoc.codes[currCode] });
        });

        throw new Error('Should not reach here');
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}
