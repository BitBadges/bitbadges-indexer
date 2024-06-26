import { ObjectCannedACL, PutObjectCommand } from '@aws-sdk/client-s3';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { Mutex } from 'async-mutex';
import {
  BalanceArray,
  iQueueDoc,
  mustConvertToCosmosAddress,
  type ErrorResponse,
  type NumberType,
  type OffChainBalancesMap,
  type iGetTokensFromFaucetSuccessResponse
} from 'bitbadgesjs-sdk';
import { serializeError } from 'serialize-error';
import { checkIfAuthenticated, mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { DEV_MODE } from '../constants';
import { getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { AirdropModel, FaucetModel, QueueModel, StatusModel } from '../db/schemas';
import { s3 } from '../indexer-vars';
import { refreshCollection } from './refresh';
import { Request, Response } from 'express';
import Stripe from 'stripe';

const STRIPE_SK = process.env.STRIPE_SECRET_KEY ?? '';
const stripe = new Stripe(STRIPE_SK);

const calculateOrderAmount = () => {
  return 1000;
};

export const checkIntentStatus = async (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const paymentIntent = await FaucetModel.findOne({
      _docId: id
    }).exec();
    if (!paymentIntent) {
      return res.status(200).send({
        success: false
      });
    }

    return res.send({ success: true });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Error checking payment intent status.'
    });
  }
};

export const createPaymentIntent = async (req: Request, res: Response) => {
  // Create a PaymentIntent with the order amount and currency
  try {
    const authDetails = await mustGetAuthDetails(req, res);
    const cosmosAddress = authDetails.cosmosAddress;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: calculateOrderAmount(),
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true
      },
      metadata: {
        cosmosAddress
      }
    });

    return res.send({
      clientSecret: paymentIntent.client_secret
    });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Error creating payment intent.'
    });
  }
};

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

export const successWebhook = async (req: Request, res: Response) => {
  try {
    const sig = req.headers['stripe-signature'] ?? '';

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntentSucceeded = event.data.object;

        //TODO: Handle if this fails?
        const id = paymentIntentSucceeded.id;
        const amount = paymentIntentSucceeded.amount;
        const cosmosAddress = mustConvertToCosmosAddress(paymentIntentSucceeded.metadata.cosmosAddress);
        const newQueueDoc: iQueueDoc<bigint> = {
          _docId: id,
          notificationType: 'faucet',
          collectionId: 0n,
          uri: '',
          loadBalanceId: 0n,
          refreshRequestTime: BigInt(Date.now()),
          numRetries: 0n,
          nextFetchTime: BigInt(Date.now()),
          faucetInfo: {
            txHash: '',
            recipient: cosmosAddress,
            amount: BigInt(amount) * BigInt(1e9)
          }
        };

        await insertToDB(QueueModel, newQueueDoc);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
        return res.status(400).end();
    }

    // Return a 200 res to acknowledge receipt of the event
    return res.send();
  } catch (e) {
    console.error(e);
    return res.status(500).send();
  }
};

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

export const batchSendTokens = async (
  sendTxs: {
    recipient: string;
    amount: NumberType;
  }[],
  memo?: string
) => {
  if (sendTxs.length === 0) {
    throw new Error('No transactions to send');
  }

  // Sign and send a MsgSend transaction
  const fromMnemonic = process.env.FAUCET_MNEMONIC ?? '';
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

  const msgs = sendTxs.map((tx) => {
    return {
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: firstAccount.address,
        toAddress: tx.recipient,
        amount: [
          {
            denom: 'ubadge',
            amount: tx.amount.toString()
          }
        ]
      }
    };
  });
  const status = await mustGetFromDB(StatusModel, 'status');
  const gasPrice = Number(status.lastXGasAmounts.reduce((a, b) => a + b, 0n)) / Number(status.lastXGasLimits.reduce((a, b) => a + b, 0n));

  const fee = {
    amount: [
      {
        denom: 'ubadge',
        amount: Math.round(gasPrice * 180000 * msgs.length).toString()
      }
    ],
    gas: Math.round(180000 * msgs.length).toString()
  };

  if (Number(fee.amount[0].amount) > 10000) {
    throw new Error('Fee too high so throwing errors');
  }

  const currHeight = await signingClient.getHeight();
  const timeoutHeight = BigInt(currHeight + 30);
  const result = await signingClient.signAndBroadcast(firstAccount.address, msgs, fee, memo, timeoutHeight);
  assertIsDeliverTxSuccess(result);

  return result;
};

export const getTokensFromFaucet = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetTokensFromFaucetSuccessResponse | ErrorResponse>
) => {
  try {
    const authDetails = await mustGetAuthDetails(req, res);

    // acquire the mutex for the documentMutexes map
    const returnValue = await faucetMutex.runExclusive(async () => {
      const isAuthenticated = await checkIfAuthenticated(req, res, [{ scopeName: 'Full Access' }]);
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
      const cosmosAddress = authDetails.cosmosAddress;
      const result = await batchSendTokens([
        {
          recipient: cosmosAddress,
          amount: 1000 * 1e9
        }
      ]);

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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: 'Error sending airdrop tokens.'
    });
  }
};
