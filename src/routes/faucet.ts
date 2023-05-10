import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import { Mutex } from "async-mutex";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { AIRDROP_DB } from "../db/db";

// Create a mutex to protect the faucet from double spending
// TODO: this solution is bottlenecked by mutex and only works on one cluster DB (bc of CouchDB eventual consistency), but it will work for now 

/**
 * Problem: How do we prevent double spending from the faucet when the blockchain is asynchronous?
 * Solution: Use a mutex to prevent double spending. 
 * 1. Acquire mutex and mark the user as airdropped in the DB. Ignore if already marked as airdropped
 * 2. Release mutex and send tokens.
 * 3. If sending tokens fails, then revert and mark the user as not airdropped in the DB.
 */
const faucetMutex = new Mutex();

export const sendTokensFromFaucet = async (expressReq: Request, res: Response) => {
  try {
    const req = expressReq as AuthenticatedRequest;
    if (!req.session.blockin || !req.session.cosmosAddress) {
      return res.status(401).send({ authenticated: false, message: 'You must Sign In w/ Ethereum.' });
    }

    // acquire the mutex for the documentMutexes map
    const returnValue = await faucetMutex.runExclusive(async () => {
      const req = expressReq as AuthenticatedRequest;
      if (!req.session.blockin || !req.session.cosmosAddress) {
        return { authenticated: false, message: 'You must Sign In w/ Ethereum.' };
      }

      const doc = await AIRDROP_DB.get(req.session.cosmosAddress).catch((e) => {
        //Only if missing error
        if (e.statusCode === 404) {
          return null;
        }
        return Promise.reject(e);
      });

      if (doc && doc.airdropped) {
        return { message: "Already airdropped" };
      } else {
        await AIRDROP_DB.insert({ ...doc, airdropped: true, _id: req.session.cosmosAddress, timestamp: Date.now() });
        return null;
      }
    });

    if (returnValue) {
      return res.status(401).send(returnValue);
    }

    try {
      //Sign and send a MsgSend transaction
      const cosmosAddress = req.session.cosmosAddress;
      const fromMnemonic = process.env.FAUCET_MNEMONIC;
      const to = cosmosAddress;

      //Get cosmos address form mnemonic
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(fromMnemonic);
      const [firstAccount] = await wallet.getAccounts();

      const signingClient = await SigningStargateClient.connectWithSigner(
        process.env.RPC_URL,
        wallet
      );

      const amount = {
        denom: "badge",
        amount: "1000",
      };


      const fee = {
        amount: [
          {
            denom: "badge",
            amount: "1",
          },
        ],
        gas: "180000",
      };
      const result = await signingClient.sendTokens(firstAccount.address, to, [amount], fee);
      assertIsDeliverTxSuccess(result);
      const doc = await AIRDROP_DB.get(req.session.cosmosAddress);
      await AIRDROP_DB.insert({ ...doc, hash: result.transactionHash, timestamp: Date.now() });

      return res.status(200).send(result);
    } catch (e) {
      const doc = await AIRDROP_DB.get(req.session.cosmosAddress);
      await AIRDROP_DB.insert({ ...doc, airdropped: false, timestamp: Date.now() });
      throw e;
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: 'Internal server error handling airdrop.' });
  }
}
