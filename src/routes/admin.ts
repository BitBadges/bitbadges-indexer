import { NumberType } from 'bitbadgesjs-sdk';
import { Response } from 'express';
import { serializeError } from 'serialize-error';
import { AuthenticatedRequest, mustGetAuthDetails } from '../blockin/blockin_handlers';
import { findInDB } from '../db/queries';
import { ErrorModel, PluginModel, QueueModel, ReportModel } from '../db/schemas';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { FaucetModel } from '../db/schemas';
import { getFromDB } from '../db/db';
import { client } from '../indexer-vars';

dotenv.config();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
const stripe = new Stripe(stripeSecretKey);

const fetchAllPaymentIntents = async () => {
  const paymentIntents: Stripe.PaymentIntent[] = [];
  let lastId: string | undefined = undefined;

  // Continuously fetch payment intents in batches
  do {
    const list: Stripe.ApiList<Stripe.PaymentIntent> = await stripe.paymentIntents.list({
      limit: 50,
      starting_after: lastId
    });
    paymentIntents.push(...list.data);
    if (list.data.length) {
      lastId = list.data[list.data.length - 1].id;
    } else {
      lastId = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`Fetched ${paymentIntents.length} payment intents...`);
  } while (lastId);

  let numErrs = 0;
  const errorIds = [];
  for (const intent of paymentIntents) {
    //if within past 10 minutes, ignore it (could still be processing)
    const created = intent.created;
    const now = Math.floor(Date.now() / 1000);
    if (now - created < 1 * 10 * 60) {
      continue;
    }

    if (!intent.status || intent.status !== 'succeeded') {
      continue;
    }

    const queueDoc = await getFromDB(QueueModel, intent.id);
    if (queueDoc) {
      numErrs++;
      errorIds.push(intent.id);
      continue;
    }

    const correspondingDoc = await FaucetModel.findOne({ _docId: intent.id });
    if (!correspondingDoc) {
      errorIds.push(intent.id);
      numErrs++;
      continue;
    }
  }

  return errorIds;
};

export const getAdminDetails = async (intentError: boolean) => {
  const reports = await findInDB(ReportModel, { query: {}, limit: 100 });
  const errorDocs = await findInDB(ErrorModel, { query: {}, limit: 100 });
  const queueErrors = await findInDB(QueueModel, { query: { error: { $exists: true } }, limit: 100 });
  const pluginSubmissions = await findInDB(PluginModel, { query: { reviewCompleted: false }, limit: 100 });
  const faucetBalance = await client?.getBalance('cosmos1kx9532ujful8vgg2dht6k544ax4k9qzszjcw04', 'ubadge');

  return { reports, errorDocs, queueErrors, pluginSubmissions, faucetBalance };
};

export async function getAdminDashboard(req: AuthenticatedRequest<NumberType>, res: Response) {
  try {
    const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;
    if (cosmosAddress !== 'cosmos1zd5dsage58jfrgmsu377pk6w0q5zhc67fn4gsl') {
      return res.status(401).send({
        error: 'Unauthorized',
        errorMessage: 'You are not authorized to view this page.'
      });
    }

    const toCheckIntents = req.query.intentErrors === 'true';
    if (toCheckIntents) {
      const errorIds = await fetchAllPaymentIntents();
      return res.status(200).send({ errorIds });
    }

    const { reports, errorDocs, queueErrors, pluginSubmissions, faucetBalance } = await getAdminDetails(toCheckIntents);

    return res.status(200).json({ reports, errorDocs, queueErrors, pluginSubmissions, faucetBalance });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
}
