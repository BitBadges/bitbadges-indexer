import { config } from 'dotenv';
import Moralis from 'moralis';

config();

if (process.env.TEST_MODE === 'true') {
  // If in test mode, do not start the Moralis server (handled in setup file)
} else {
  console.log('Starting Moralis server...');
  Moralis.start({
    apiKey: process.env.MORALIS_API_KEY
  }).catch(console.error);
}

import axios from 'axios';
import { type ErrorResponse } from 'bitbadgesjs-sdk';
import MongoStore from 'connect-mongo';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { type Attribute } from 'cosmjs-types/cosmos/base/abci/v1beta1/abci';
import crypto from 'crypto';
import express, { NextFunction, type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import expressSession from 'express-session';
import fs from 'fs';
import helmet from 'helmet';
import https from 'https';
import mongoose from 'mongoose';
import multer from 'multer';
import passport from 'passport';
import responseTime from 'response-time';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { discordCallbackHandler, githubCallbackHandler, googleCallbackHandler, twitchCallbackHandler, twitterAuthorizeHandler } from './auth/oauth';
import {
  authorizeBlockinRequest,
  checkifSignedInHandler,
  genericBlockinVerifyAssetsHandler,
  genericBlockinVerifyHandler,
  getChallenge,
  removeBlockinSessionCookie,
  verifyBlockinAndGrantSessionCookie
} from './blockin/blockin_handlers';
import { insertToDB } from './db/db';
import { ApiKeyDoc } from './db/docs';
import { findInDB } from './db/queries';
import { ApiKeyModel } from './db/schemas';
import { OFFLINE_MODE, client } from './indexer-vars';
import { connectToRpc, poll, pollNotifications, pollUris } from './poll';
import { createAddressLists, deleteAddressLists, getAddressLists, updateAddressLists } from './routes/addressLists';
import { createApiKey, deleteApiKey, getApiKeys, rotateApiKey } from './routes/apiKeys';
import { createDeveloperApp, deleteDeveloperApp, getDeveloperApps, updateDeveloperApp } from './routes/authApps';
import {
  createSIWBBRequest,
  deleteSIWBBRequest,
  exchangeSIWBBAuthorizationCode,
  getSIWBBRequestsForDeveloperApp,
  getSiwbbAuthorizations,
  revokeSiwbbHandler,
  rotateSIWBBRequest
} from './routes/authCodes';
import { getOwnersForBadge } from './routes/badges';
import { getBadgeBalanceByAddress } from './routes/balances';
import { broadcastTx, simulateTx } from './routes/broadcast';
import { getBrowseCollections } from './routes/browse';
import { getClaimAlertsForCollection, sendClaimAlert } from './routes/claimAlerts';
import {
  completeClaim,
  createClaimHandler,
  deleteClaimHandler,
  getClaimsHandler,
  getClaimsStatusHandler,
  getReservedClaimCodes,
  simulateClaim,
  updateClaimHandler
} from './routes/claims';
import { getBadgeActivity, getCollections } from './routes/collections';
import { oneTimeSendEmailHandler, oneTimeVerifyEmailHandler, unsubscribeHandler, verifyEmailHandler } from './routes/email';
import { getBalancesForEthFirstTx } from './routes/ethFirstTx';
import { checkIntentStatus, createPaymentIntent, getTokensFromFaucet, successWebhook } from './routes/faucet';
import { getFollowDetails } from './routes/follows';
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addToIpfsHandler } from './routes/ipfs';
import { getMaps } from './routes/maps';
import { fetchMetadataDirectly } from './routes/metadata';
import {
  createAttestation,
  createAttestationProof,
  deleteAttestation,
  deleteAttestationProof,
  getAttestation,
  getAttestationProof,
  updateAttestation
} from './routes/offChainSecrets';
import { createGooglePass, createPass } from './routes/pass';
import { createPlugin, deletePlugin, getPlugins, updatePlugin } from './routes/plugins';
import { getRefreshStatus, refreshMetadata } from './routes/refresh';
import { addReport } from './routes/reports';
import { addReview, deleteReview } from './routes/reviews';
import { filterBadgesInCollectionHandler, getFilterSuggestionsHandler, searchHandler } from './routes/search';
import { getStatusHandler } from './routes/status';
import { getAccounts, updateAccountInfo } from './routes/users';
import { getAdminDashboard } from './routes/admin';

axios.defaults.timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 10000; // Set the default timeout value in milliseconds

export let SHUTDOWN = false;
export const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value;
};

export let timer: NodeJS.Timer | undefined;
export const setTimer = (newTimer: NodeJS.Timer | undefined) => {
  timer = newTimer;
};

export let uriPollerTimer: NodeJS.Timer | undefined;
export const setUriPollerTimer = (newTimer: NodeJS.Timer | undefined) => {
  uriPollerTimer = newTimer;
};

export let notificationPollerTimer: NodeJS.Timer | undefined;
export const setNotificationPollerTimer = (newTimer: NodeJS.Timer | undefined) => {
  notificationPollerTimer = newTimer;
};

const upload = multer({ dest: 'uploads/' });
const app: Express = express();
const port = process.env.port ? Number(process.env.port) : 3001;
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

const freeTierLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const errorResponse: ErrorResponse = {
      errorMessage: 'Exceeded rate limit. Too many requests,'
    };
    res.status(429).json(errorResponse);
  }
});

const apiKeyTierLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const errorResponse: ErrorResponse = {
      errorMessage: 'Exceeded rate limit. Too many requests,'
    };
    res.status(429).json(errorResponse);
  },
  keyGenerator: async (req) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      return apiKey.toString();
    } else {
      return Promise.reject(new Error('API key not found.'));
    }
  }
});

const apiKeyHandler = async (req: Request, res: Response, next: NextFunction) => {
  // Validate API key
  const apiKey = req.headers['x-api-key'];
  try {
    if (process.env.TEST_MODE === 'true') {
      next();
      return;
    }

    const identifier = apiKey ? apiKey.toString() : req.ip?.toString();
    if (!identifier) {
      throw new Error('Unauthorized request. Could not identify origin of request.');
    }

    const identifierHash = crypto.createHash('sha256').update(identifier).digest('hex');

    const docs = await findInDB(ApiKeyModel, { query: { apiKey: { $eq: identifierHash } }, limit: 1 });
    let doc = docs?.[0];
    if (!doc) {
      if (apiKey) {
        throw new Error('Unauthorized request. API key not found.');
      }

      // Deterministic ID to avoid creating duplicate docs
      // Yes, first load might overwrite the same doc a couple times if many simultaneous reqs but it's fine
      const uniqueDocId = crypto
        .createHash('sha256')
        .update(identifier + 'bitbadges')
        .digest('hex');

      const newDoc: ApiKeyDoc = {
        _docId: uniqueDocId,
        apiKey: identifierHash,
        numRequests: 0,
        expiry: Number.MAX_SAFE_INTEGER,
        tier: 'free',
        lastRequest: Date.now(),
        label: '',
        cosmosAddress: '',
        createdAt: Date.now(),
        intendedUse: ''
      };

      await insertToDB(ApiKeyModel, newDoc);
      doc = newDoc;
      res.locals.apiKey = false;
    }

    if (doc.expiry < Date.now()) {
      throw new Error('Unauthorized request. API key has expired.');
    }

    const lastRequestWasYesterday = new Date(doc.lastRequest).getDate() !== new Date().getDate();
    if (lastRequestWasYesterday) {
      doc.numRequests = 0;
    }

    if (doc.tier === 'standard') {
      if (doc.numRequests > 250000) {
        throw new Error('Unauthorized request. API key has exceeded its request daily limit.');
      }
    } else if (doc.tier === 'free') {
      if (doc.numRequests > 50000) {
        throw new Error('Unauthorized request. API key has exceeded its request daily limit.');
      }
    }

    await ApiKeyModel.findOneAndUpdate({ _docId: doc._docId }, [
      {
        $set: {
          numRequests: {
            $add: [`$numRequests`, 1]
          }
        }
      },
      {
        $set: {
          lastRequest: Date.now()
        }
      }
    ]);

    if (!apiKey) {
      // Free tier rate limit for basic requests
      return freeTierLimiter(req, res, next);
    } else {
      // API key rate limit for more advanced requests
      res.locals.apiKey = true;
      return apiKeyTierLimiter(req, res, next);
    }
  } catch (error) {
    console.log(error);

    return res.status(401).json({
      errorMessage: 'Unauthorized request. Error validating API key.'
    });
  }
};

// const requireApiKeyHandler = async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     if (!res.locals.apiKey) {
//       throw new Error('Unauthorized request. API key required.');
//     }

//     next();
//     return;
//   } catch (error) {
//     console.log(error);

//     return res.status(401).json({
//       errorMessage: 'Unauthorized request. API key is required.'
//     });
//   }
// };

//IMPORTANT: Note this should not be depended on for security. It just makes it harder to access endpoints that are not meant to be accessed by the public.
const websiteOnlyCorsOptions = {
  // localhost or deployed

  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL : 'https://bitbadges.io',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};
const websiteOnlyCors = cors(websiteOnlyCorsOptions);

app.set('trust proxy', process.env.DEV_MODE === 'true' ? 0 : 1); // trust first proxy
app.use(apiKeyHandler);

// console.log the repsonse
app.use(responseTime({ suffix: false }));

app.post('/webhook', express.raw({ type: 'application/json' }), successWebhook);

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"], // Add domains for allowed scripts
        styleSrc: ["'self'"], // Add domains for allowed styles
        imgSrc: ["'self'"], // Add domains for allowed images
        connectSrc: ["'self'"], // Add domains for allowed connections (e.g., API endpoints)
        fontSrc: ["'self'"], // Add domains for allowed fonts
        objectSrc: ["'none'"], // Disallow object/embed tags
        upgradeInsecureRequests: [] // Upgrade HTTP to HTTPS
      }
    }
  })
);

const isProduction = process.env.DEV_MODE !== 'true';
app.use(
  expressSession({
    name: 'bitbadges',
    secret: process.env.SESSION_SECRET ? process.env.SESSION_SECRET : '',
    resave: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      crypto: {
        secret: process.env.SESSION_SECRET ?? ''
      }
    }),
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax'
    }
  })
);

app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req: Request, res: Response) => {
  return res.send({
    message: 'Hello from the BitBadges indexer! See docs.bitbadges.io for documentation.'
  });
});

// Status
app.post('/api/v0/status', getStatusHandler);
app.get('/api/v0/admin', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getAdminDashboard);

// Set route to start OAuth link, this is where you define scopes to request
app.get('/auth/twitch', passport.authenticate('twitch', { scope: 'user_read user:read:follows user:read:subscriptions' }));
app.get('/auth/twitch/callback', twitchCallbackHandler);

app.get('/auth/discord', passport.authenticate('discord', { session: false }));
app.get('/auth/discord/callback', discordCallbackHandler);

app.get('/auth/twitter', twitterAuthorizeHandler);
app.get('/auth/twitter/callback', twitchCallbackHandler);

app.get('/auth/github', passport.authenticate('github', { session: false }));
app.get('/auth/github/callback', githubCallbackHandler);

app.get('/auth/google', passport.authenticate('google', { session: false, scope: ['profile', 'email'], accessType: 'offline', prompt: 'consent' }));
app.get('/auth/google/callback', googleCallbackHandler);

// Reports
app.post('/api/v0/report', authorizeBlockinRequest([{ scopeName: 'Report' }]), addReport);

// Search
app.post('/api/v0/search/:searchValue', searchHandler);

// Collections
app.post('/api/v0/collections', getCollections);
app.post('/api/v0/collection/:collectionId/:badgeId/owners', getOwnersForBadge);
app.post('/api/v0/collection/:collectionId/balance/:cosmosAddress', getBadgeBalanceByAddress);
app.post('/api/v0/collection/:collectionId/:badgeId/activity', getBadgeActivity);

app.post('/api/v0/collection/:collectionId/refresh', refreshMetadata);
app.post('/api/v0/collection/:collectionId/refreshStatus', getRefreshStatus);
app.post('/api/v0/collection/:collectionId/filter', filterBadgesInCollectionHandler);
app.post('/api/v0/collection/:collectionId/filterSuggestions', websiteOnlyCors, getFilterSuggestionsHandler);

app.post('/api/v0/claims/simulate/:claimId/:cosmosAddress', simulateClaim);
app.post('/api/v0/claims/complete/:claimId/:cosmosAddress', completeClaim);
app.post('/api/v0/claims/reserved/:claimId/:cosmosAddress', getReservedClaimCodes);
app.post('/api/v0/claims/status/:claimAttemptId', getClaimsStatusHandler);

app.post('/api/v0/claims/fetch', getClaimsHandler);
app.post('/api/v0/claims', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createClaimHandler);
app.put('/api/v0/claims', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), updateClaimHandler);
app.delete('/api/v0/claims', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), deleteClaimHandler);

//Reviews
app.post('/api/v0/reviews/add', authorizeBlockinRequest([{ scopeName: 'Reviews' }]), addReview);
app.delete('/api/v0/reviews/delete/:reviewId', authorizeBlockinRequest([{ scopeName: 'Reviews' }]), deleteReview);

// User
app.post('/api/v0/users', getAccounts);
app.post('/api/v0/user/updateAccount', upload.single('profilePicImageFile'), updateAccountInfo);

// IPFS
app.post(
  '/api/v0/addToIpfs',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  express.json({ limit: '100mb' }),
  addToIpfsHandler
);

app.post(
  '/api/v0/addApprovalDetailsToOffChainStorage',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  express.json({ limit: '100mb' }),
  addApprovalDetailsToOffChainStorageHandler
); //

app.post(
  '/api/v0/addBalancesToOffChainStorage',
  authorizeBlockinRequest([{ scopeName: 'Manage Off-Chain Balances' }]),
  express.json({ limit: '100mb' }),
  addBalancesToOffChainStorageHandler
); //

// Blockin Auth - bitbadges.io only
app.post('/api/v0/auth/getChallenge', websiteOnlyCors, getChallenge);
app.post('/api/v0/auth/verify', websiteOnlyCors, verifyBlockinAndGrantSessionCookie);
app.post('/api/v0/auth/logout', websiteOnlyCors, removeBlockinSessionCookie);
app.post('/api/v0/auth/status', checkifSignedInHandler);

app.post('/api/v0/siwbbRequest/verify', genericBlockinVerifyHandler);
app.post('/api/v0/verifyOwnershipRequirements', genericBlockinVerifyAssetsHandler);

// Fetch arbitrary metadata - bitbadges.io only
app.post('/api/v0/metadata', websiteOnlyCors, fetchMetadataDirectly);

// Browse
app.post('/api/v0/browse', getBrowseCollections);

// Broadcasting
app.post('/api/v0/broadcast', broadcastTx);
app.post('/api/v0/simulate', simulateTx);

// Faucet / Stripe
app.post('/api/v0/faucet', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getTokensFromFaucet);
app.get(`/api/v0/checkout-status/:id`, websiteOnlyCors, checkIntentStatus);
app.post('/api/v0/stripe/createPaymentIntent', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createPaymentIntent);

// Address Lists
app.post('/api/v0/addressLists/fetch', getAddressLists);
app.post('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Create Address Lists' }]), createAddressLists);
app.put('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Update Address Lists' }]), updateAddressLists);
app.delete('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Delete Address Lists' }]), deleteAddressLists);

// Claim Alerts
app.post('/api/v0/claimAlerts/send', sendClaimAlert);
app.post('/api/v0/claimAlerts', authorizeBlockinRequest([{ scopeName: 'Read Claim Alerts' }]), getClaimAlertsForCollection);

// Follow Protocol
app.post('/api/v0/follow-protocol', getFollowDetails);

// Eth First Tx
app.post('/api/v0/ethFirstTx/:cosmosAddress', getBalancesForEthFirstTx);

// Maps
app.post('/api/v0/maps', getMaps);

app.post('/api/v0/siwbbRequest/appleWalletPass', createPass);
app.post('/api/v0/siwbbRequest/googleWalletPass', createGooglePass);

// Off-Chain Attestation Sigs
app.post('/api/v0/attestation/fetch', getAttestation);
app.post('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Create Attestations' }]), createAttestation);
app.delete('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Delete Attestations' }]), deleteAttestation);
app.put('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Update Attestations' }]), updateAttestation);
app.post('/api/v0/attestationProof/fetch', getAttestationProof);
app.post('/api/v0/attestationProof', authorizeBlockinRequest([{ scopeName: 'Create Attestations' }]), createAttestationProof);
app.delete('/api/v0/attestationProof', authorizeBlockinRequest([{ scopeName: 'Delete Attestations' }]), deleteAttestationProof);
// app.put('/api/v0/attestationProof', authorizeBlockinRequest([{ scopeName: 'Update Attestations' }]), updateAttestation);

// Auth Apps
app.post('/api/v0/developerApp/fetch', websiteOnlyCors, getDeveloperApps);
app.post('/api/v0/developerApp', websiteOnlyCors, createDeveloperApp);
app.delete('/api/v0/developerApp', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), deleteDeveloperApp);
app.put('/api/v0/developerApp', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), updateDeveloperApp);
app.post('/api/v0/developerApp/siwbbRequests', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getSIWBBRequestsForDeveloperApp);

// Auth Apps
app.post('/api/v0/plugins/fetch', getPlugins);
app.post('/api/v0/plugins', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createPlugin);
app.put('/api/v0/plugins', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), updatePlugin);
app.delete('/api/v0/plugins', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), deletePlugin);

app.get('/api/v0/unsubscribe/:token', unsubscribeHandler);
app.get('/api/v0/verifyEmail/:token', websiteOnlyCors, verifyEmailHandler);
app.post('/api/v0/oneTimeVerify/send', websiteOnlyCors, oneTimeSendEmailHandler);
app.post('/api/v0/oneTimeVerify/verify', websiteOnlyCors, oneTimeVerifyEmailHandler);

// Siwbb / Oauth
app.post('/api/v0/siwbb/token', exchangeSIWBBAuthorizationCode);
app.post('/api/v0/siwbb/token/revoke', revokeSiwbbHandler);
app.post('/api/v0/siwbbRequest', createSIWBBRequest);
app.delete('/api/v0/siwbbRequest', authorizeBlockinRequest([{ scopeName: 'Delete Authentication Codes' }]), deleteSIWBBRequest);
app.post('/api/v0/siwbbRequest/rotate', authorizeBlockinRequest([{ scopeName: 'Create Authentication Codes' }]), rotateSIWBBRequest);
app.post('/api/v0/oauth/authorizations', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getSiwbbAuthorizations);

//Api Keys
app.post('/api/v0/apiKeys', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createApiKey);
app.post('/api/v0/apiKeys/rotate', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), rotateApiKey);
app.delete('/api/v0/apiKeys', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), deleteApiKey);
app.post('/api/v0/apiKeys/fetch', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getApiKeys);

// Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
  if (!OFFLINE_MODE) {
    if (process.env.DISABLE_BLOCKCHAIN_POLLER !== 'true') {
      if (process.env.HEARTBEAT_MODE === 'true') {
        // Heartbeat mode
      } else {
        setTimeout(poll, 1);
      }
    }

    if (process.env.DISABLE_URI_POLLER !== 'true') {
      setTimeout(pollUris, 1);
    }

    if (process.env.DISABLE_NOTIFICATION_POLLER !== 'true') {
      setTimeout(pollNotifications, 1);
    }
  }
};

function checkIfConnected() {
  try {
    if (!client) connectToRpc();
  } catch (e) {
    console.error(e);
  }

  console.log('Checking if connected to blockchain...');
  if (!SHUTDOWN) {
    console.log('Setting timer to check if connected to blockchain again in 15 seconds.');
    setTimeout(checkIfConnected, 15000);
  }
}

if (process.env.DISABLE_BLOCKCHAIN_POLLER === 'true') {
  //we need to connect the client to the blockchain
  //set up an interval to check if the client is connected
  console.log('Blockchain poller disabled so will auto-poll the blockchain every 15 seconds to check if connected.');

  setTimeout(checkIfConnected, 1);
}

export const server =
  process.env.DISABLE_API === 'true'
    ? undefined
    : isProduction
      ? https
          .createServer(
            {
              key: fs.readFileSync('server.key'),
              cert: fs.readFileSync('server.cert')
            },
            app
          )
          .listen(port, () => {
            init()
              .then(() => {
                console.log(`\nserver started at https://localhost:${port}`, Date.now().toLocaleString());
              })
              .catch(console.error);
          })
      : app.listen(port, () => {
          init()
            .catch(console.error)
            .then(() => {
              console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
            });
        });

if (process.env.DISABLE_API === 'true') {
  console.log('API server disabled');
  init().catch(console.error);
}

const wsHttpsServer =
  process.env.DISABLE_API === 'true' || !isProduction
    ? undefined
    : https
        .createServer({
          key: fs.readFileSync('server.key'),
          cert: fs.readFileSync('server.cert')
        })
        .listen(8080, () => {
          console.log('\nWebSocket server is running on wss://localhost:8080');
        });

const wsServer =
  process.env.DISABLE_API !== 'true'
    ? new WebSocket.Server({
        port: process.env.DISABLE_API === 'true' ? undefined : isProduction ? undefined : 8080,
        server: process.env.DISABLE_API === 'true' ? undefined : isProduction ? wsHttpsServer : undefined
      })
    : undefined;
const clients = new Map();

interface WebSocketWithPair extends WebSocket {
  pair: WebSocketWithPair | null;
}

wsServer?.on('connection', (ws: WebSocketWithPair) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  ws.send(JSON.stringify({ type: 'id', id: clientId }));

  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(Buffer.from(message as any).toString());

    if (parsedMessage.type === 'pair') {
      const pairClient = clients.get(parsedMessage.id);
      if (pairClient) {
        ws.pair = pairClient;
        pairClient.pair = ws;
        ws.send('Connected with a peer');
        pairClient.send('Connected with a peer');
      } else {
        ws.send('Client not found');
      }
    } else if (parsedMessage.type === 'disconnect') {
      const pairClient = ws.pair;
      if (pairClient) {
        pairClient.send('Your peer has disconnected');
        pairClient.pair = null;
      }
      ws.pair = null;

      // we also want to remove the client from the map and establish a new ID
      clients.delete(clientId);
      const newClientId = uuidv4();
      clients.set(newClientId, ws);
      ws.send(JSON.stringify({ type: 'id', id: newClientId }));
    } else if (parsedMessage.type !== 'id') {
      const pairClient = ws.pair;
      if (pairClient && pairClient.readyState === WebSocket.OPEN) {
        pairClient.send(Buffer.from(message as any).toString());
      } else if (!pairClient || pairClient?.readyState !== WebSocket.OPEN) {
        ws.send('Your peer has disconnected');
        ws.pair = null;
      }
    }
  });

  ws.on('close', () => {
    const pairClient = ws.pair;
    if (pairClient) {
      pairClient.send('Your peer has disconnected');
      pairClient.pair = null;
    }
    clients.delete(clientId);
  });
});

export const gracefullyShutdown = async () => {
  SHUTDOWN = true;
  server?.close(() => {
    console.log('server closed');
  });

  client?.disconnect();

  // console.log('clearing timer', timer);
  // if (timer) clearTimeout(timer);

  // console.log('clearing uriPollerTimer', uriPollerTimer);
  // if (uriPollerTimer) clearTimeout(uriPollerTimer);

  // console.log('clearing notificationPollerTimer', notificationPollerTimer);
  // if (notificationPollerTimer) clearTimeout(notificationPollerTimer);

  wsServer?.close(() => {
    console.log('WebSocket server closed');
  });

  setTimeout(() => {
    mongoose.connection.close();
    console.log('mongoose connection closed');
  }, 10000);
};

process.on('SIGINT', gracefullyShutdown);
process.on('SIGTERM', gracefullyShutdown);

export default app;
