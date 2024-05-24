import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { Mutex } from 'async-mutex';
import {
  BalanceArray,
  type ErrorResponse,
  type NumberType,
  type OffChainBalancesMap,
  type iGetTokensFromFaucetSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { DEV_MODE } from '../constants';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AirdropModel } from '../db/schemas';
import { s3 } from '../indexer-vars';
import { refreshCollection } from './refresh';

// Create a mutex to protect the faucet from double spending
// TODO: this solution is bottlenecked by mutex and only works on one cluster DB; it will work for now  but needs a refactor

/**
 * Problem: How do we prevent double spending from the faucet when the blockchain is asynchronous?
 * Solution: Use a mutex to prevent double spending.
 * 1. Acquire mutex and mark the user as airdropped in the DB. Ignore if already marked as airdropped
 * 2. Release mutex and send tokens.
 * 3. If sending tokens fails, then revert and mark the user as not airdropped in the DB.
 */
const faucetMutex = new Mutex();

export const getTokensFromFaucet = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetTokensFromFaucetSuccessResponse | ErrorResponse>
) => {
  try {
    const authDetails = await mustGetAuthDetails(req);

    // acquire the mutex for the documentMutexes map
    const returnValue = await faucetMutex.runExclusive(async () => {
      const isAuthenticated = await checkIfAuthenticated(req, ['Full Access']);
      if (!isAuthenticated) {
        return { authenticated: false, errorMessage: 'You must be authorized.' };
      }

      const doc = await getFromDB(AirdropModel, authDetails.cosmosAddress);

      if (doc && doc.airdropped) {
        return { errorMessage: 'Already airdropped' };
      } else {
        await insertToDB(AirdropModel, {
          ...doc,
          airdropped: true,
          _docId: authDetails.cosmosAddress,
          timestamp: Date.now()
        });
        return null;
      }
    });

    if (returnValue) {
      return res.status(401).send(returnValue);
    }

    try {
      // Sign and send a MsgSend transaction
      const cosmosAddress = authDetails.cosmosAddress;
      const fromMnemonic = process.env.FAUCET_MNEMONIC ?? '';
      const to = cosmosAddress;

      // Get cosmos address form mnemonic
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(fromMnemonic);
      const [firstAccount] = await wallet.getAccounts();

      const rpcs = JSON.parse(process.env.RPC_URLS ?? '["http://localhost:26657"]') as string[];

      let signingClient;
      for (let i = 0; i < rpcs.length; i++) {
        try {
          signingClient = await SigningStargateClient.connectWithSigner(rpcs[i], wallet);
          break;
        } catch (e) {
          console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`);
        }
      }

      if (!signingClient) {
        throw new Error('Could not connect to any RPCs');
      }

      const amount = {
        denom: 'badge',
        amount: '1000'
      };

      const fee = {
        amount: [
          {
            denom: 'badge',
            amount: '1'
          }
        ],
        gas: '180000'
      };
      const result = await signingClient.sendTokens(firstAccount.address, to, [amount], fee);
      assertIsDeliverTxSuccess(result);

      await insertToDB(AirdropModel, {
        _docId: authDetails.cosmosAddress,
        airdropped: true,
        hash: result.transactionHash,
        timestamp: Date.now()
      });

      if (!DEV_MODE) {
        const allAirdropped = await AirdropModel.find().exec();
        const airdropped = allAirdropped.filter((doc) => doc.airdropped).map((doc) => doc._docId);
        const balancesMap: OffChainBalancesMap<bigint> = {};
        for (const address of airdropped) {
          balancesMap[address] = BalanceArray.From([
            {
              amount: 1n,
              badgeIds: [{ start: 1n, end: 1n }],
              ownershipTimes: [{ start: 1n, end: 18446744073709551615n }]
            }
          ]);
        }

        const binaryData = JSON.stringify(balancesMap);

        const params = {
          Body: binaryData,
          Bucket: 'bitbadges-balances',
          Key: 'airdrop/balances',
          ACL: ObjectCannedACL.public_read,
          ContentType: 'application/json'
        };
        await s3.send(new PutObjectCommand(params));

        // trigger refresh
        await refreshCollection('2', true);
      }

      return res.status(200).send(result);
    } catch (e) {
      // Handle case where sending tokens fails. Need to revert the airdrop status
      const doc = await mustGetFromDB(AirdropModel, authDetails.cosmosAddress);
      await insertToDB(AirdropModel, { ...doc, airdropped: false, timestamp: Date.now() });
      throw e;
    }
  } catch (e) {
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error sending airdrop tokens.'
    });
  }
};
