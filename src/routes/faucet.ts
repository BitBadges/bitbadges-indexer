import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import { Mutex } from "async-mutex";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";
import { AIRDROP_DB, insertToDB } from "../db/db";
import _ from "environment"
import { serializeError } from "serialize-error";
import { GetTokensFromFaucetRouteResponse, NumberType } from "bitbadgesjs-utils";

// Create a mutex to protect the faucet from double spending
// TODO: this solution is bottlenecked by mutex and only works on one cluster DB (bc of CouchDB eventual consistency); it will work for now  but needs a refactor

/**
 * Problem: How do we prevent double spending from the faucet when the blockchain is asynchronous?
 * Solution: Use a mutex to prevent double spending. 
 * 1. Acquire mutex and mark the user as airdropped in the DB. Ignore if already marked as airdropped
 * 2. Release mutex and send tokens.
 * 3. If sending tokens fails, then revert and mark the user as not airdropped in the DB.
 */
const faucetMutex = new Mutex();

export const getTokensFromFaucet = async (expressReq: Request, res: Response<GetTokensFromFaucetRouteResponse<NumberType>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;

    // acquire the mutex for the documentMutexes map
    const returnValue = await faucetMutex.runExclusive(async () => {
      const req = expressReq as AuthenticatedRequest<NumberType>;
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
        await insertToDB(AIRDROP_DB, { ...doc, airdropped: true, _id: req.session.cosmosAddress, timestamp: Date.now() });
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

      const rpcs = JSON.parse(process.env.RPC_URLS || '["http://localhost:26657"]') as string[]

      let signingClient;
      for (let i = 0; i < rpcs.length; i++) {
        try {
          signingClient = await SigningStargateClient.connectWithSigner(
            rpcs[i],
            wallet
          );
          break;
        } catch (e) {
          console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`)
        }
      }

      if (!signingClient) {
        throw new Error('Could not connect to any RPCs');
      }

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
      await insertToDB(AIRDROP_DB, { ...doc, hash: result.transactionHash, timestamp: Date.now() });

      return res.status(200).send(result);
    } catch (e) {
      const doc = await AIRDROP_DB.get(req.session.cosmosAddress);
      await insertToDB(AIRDROP_DB, { ...doc, airdropped: false, timestamp: Date.now() });
      throw e;
    }
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      message: "Error sending airdrop tokens. Please try again later."
    });
  }
}
