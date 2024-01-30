import axios from 'axios'
import { ErrorResponse } from 'bitbadgesjs-utils'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { Attribute } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import rateLimit from 'express-rate-limit'
import expressSession from 'express-session'
import mongoose from 'mongoose'
import Moralis from 'moralis'
import multer from 'multer'
import responseTime from 'response-time'
import { serializeError } from 'serialize-error'
import { authorizeBlockinRequest, checkifSignedInHandler, genericBlockinVerifyHandler, getChallenge, removeBlockinSessionCookie, verifyBlockinAndGrantSessionCookie } from "./blockin/blockin_handlers"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ApiKeyModel, ProfileModel, insertToDB, mustGetFromDB } from './db/db'
import { OFFLINE_MODE, TIME_MODE } from './indexer-vars'
import { poll, pollNotifications, pollUris } from "./poll"
import { deleteAddressLists, getAddressLists, updateAddressLists } from './routes/addressLists'
import { createAuthCode, deleteAuthCode, getAuthCode } from './routes/authCodes'
import { getOwnersForBadge } from './routes/badges'
import { getBadgeBalanceByAddress } from "./routes/balances"
import { broadcastTx, simulateTx } from './routes/broadcast'
import { getBrowseCollections } from './routes/browse'
import { getClaimAlertsForCollection, sendClaimAlert } from './routes/claimAlerts'
import { getAllCodesAndPasswords } from "./routes/codes"
import { getBadgeActivity, getCollectionById, getCollections } from "./routes/collections"
import { getBalancesForEthFirstTx } from './routes/ethFirstTx'
import { getTokensFromFaucet } from './routes/faucet'
import { getFollowDetails } from './routes/follows'
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addMetadataToIpfsHandler } from "./routes/ipfs"
import { fetchMetadataDirectly, } from "./routes/metadata"
import { getMerkleChallengeCodeViaPassword } from "./routes/passwords"
import { getCollectionForProtocol, getProtocols } from './routes/protocols'
import { getRefreshStatus, refreshMetadata } from './routes/refresh'
import { addReport } from './routes/reports'
import { addReviewForCollection, addReviewForUser, deleteReview } from './routes/reviews'
import { filterBadgesInCollectionHandler, searchHandler } from "./routes/search"
import { getStatusHandler } from "./routes/status"
import { addAddressToSurvey } from './routes/surveys'
import { getAccount, getAccounts, updateAccountInfo } from "./routes/users"

axios.defaults.timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000; // Set the default timeout value in milliseconds
config()

Moralis.start({
  apiKey: process.env.MORALIS_API_KEY
});


// Basic rate limiting middleware for Express. Limits requests to 30 per minute.
// Initially put in place to protect against infinite loops.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minutes
  max: 100, // Limit each IP to 30 requests per `window` (here, per minute)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const errorResponse: ErrorResponse = {
      errorMessage: 'Exceeded rate limit. Too many requests, please try again later.',
    }
    res.status(429).json(errorResponse);
  },
})

export let SHUTDOWN = false;


export const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value
}


export let client: IndexerStargateClient
export const setClient = (newClient: IndexerStargateClient) => {
  client = newClient
}

export let timer: NodeJS.Timer | undefined
export const setTimer = (newTimer: NodeJS.Timer) => {
  timer = newTimer
}

export let uriPollerTimer: NodeJS.Timer | undefined
export const setUriPollerTimer = (newTimer: NodeJS.Timer) => {
  uriPollerTimer = newTimer
}

export let heartbeatTimer: NodeJS.Timer | undefined
export const setHeartbeatTimer = (newTimer: NodeJS.Timer) => {
  heartbeatTimer = newTimer
}


export let notificationPollerTimer: NodeJS.Timer | undefined
export const setNotificationPollerTimer = (newTimer: NodeJS.Timer) => {
  notificationPollerTimer = newTimer
}

const upload = multer({ dest: 'uploads/' });
const app: Express = express()
const port = process.env.port ? Number(process.env.port) : 3001
app.set('trust proxy', 1);


app.use(cors({
  origin: true,
  credentials: true,
}))

app.use(async (req, res, next) => {
  //Check if trusted origin

  const origin = req.headers.origin;

  if (origin && (origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io')) {
    return next();
  } else {
    //Validate API key
    const apiKey = req.headers['x-api-key'];
    try {

      if (!apiKey) {
        throw new Error('Unauthorized request. API key is required but none was provided.');
      }

      const doc = await mustGetFromDB(ApiKeyModel, apiKey as string);

      const lastRequestWasYesterday = new Date(doc.lastRequest).getDate() !== new Date().getDate();
      if (lastRequestWasYesterday) {
        doc.numRequests = 0;
      }

      if (doc.numRequests > 10000) {
        throw new Error('Unauthorized request. API key has exceeded its request daily limit.');
      }

      await insertToDB(ApiKeyModel, {
        ...doc,
        numRequests: doc.numRequests + 1,
        lastRequest: Date.now(),
      });

      return next();
    } catch (error) {
      console.log(error);
      const errorResponse: ErrorResponse = {
        errorMessage: 'Unauthorized request. API key is required.',
      }
      return res.status(401).json(errorResponse);
    }
  }
});




var websiteOnlyCorsOptions = {
  //localhost or deployed

  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL : 'https://bitbadges.io',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}
const websiteOnlyCors = cors(websiteOnlyCorsOptions);


//Use limiter but provide a custom error response
app.use(limiter);
// app.use(timeout('30s'));
//console.log the repsonse
app.use(responseTime((req: Request, response: Response, time: number) => {
  if (TIME_MODE) {
    console.log(`${req.method} ${req.url}: ${time} ms`);
    if (time > 1500) {
      console.log('SLOW REQUEST!');
      console.log(JSON.stringify(req.body, null, 2).substring(0, 250))
    }
  }
}));

app.use(express.json({ limit: '100mb' }))


app.use(expressSession({
  proxy: true,
  name: 'blockin',
  secret: process.env['SESSION_SECRET'] ? process.env['SESSION_SECRET'] : '',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true, httpOnly: true,
    sameSite: 'none',
  }
}));

app.use(cookieParser());

// app.use((req, res, next) => {
//   // if (!TIME_MODE) {
//   //   console.log();
//   //   console.log(req.method, req.url);
//   //   console.log(JSON.stringify(req.body, null, 2));
//   // }
//   next();
// });

app.get("/", (req: Request, res: Response) => {
  return res.send({
    message: "Hello from the BitBadges indexer! See docs.bitbadges.io for documentation.",
  })
})

//Status
app.post("/api/v0/status", getStatusHandler);

//Reports
app.post("/api/v0/report", cors(websiteOnlyCorsOptions), authorizeBlockinRequest, addReport);

//Search
app.post("/api/v0/search/:searchValue", searchHandler);

//Collections
app.post("/api/v0/collection/batch", getCollections)
app.post("/api/v0/collection/:collectionId", getCollectionById)
app.post('/api/v0/collection/:collectionId/:badgeId/owners', getOwnersForBadge);
app.post('/api/v0/collection/:collectionId/balance/:cosmosAddress', getBadgeBalanceByAddress);
app.post('/api/v0/collection/:collectionId/:badgeId/activity', getBadgeActivity);

app.post('/api/v0/collection/:collectionId/refresh', refreshMetadata); //Write route
app.post('/api/v0/collection/:collectionId/refreshStatus', getRefreshStatus); //Write route

app.post('/api/v0/collection/:collectionId/codes', authorizeBlockinRequest, getAllCodesAndPasswords);
app.post('/api/v0/collection/:collectionId/password/:cid/:password', authorizeBlockinRequest, getMerkleChallengeCodeViaPassword); //Write route

app.post("/api/v0/collections/filter", filterBadgesInCollectionHandler);

app.post('/api/v0/collection/:collectionId/addReview', authorizeBlockinRequest, addReviewForCollection); //Write route
app.post('/api/v0/deleteReview/:reviewId', authorizeBlockinRequest, deleteReview); //Write route


//User
app.post('/api/v0/user/batch', getAccounts);
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest, upload.single('profilePicImageFile'), updateAccountInfo); //Write route
app.post('/api/v0/user/:addressOrUsername', getAccount);
app.post('/api/v0/user/:addressOrUsername/addReview', authorizeBlockinRequest, addReviewForUser); //Write route

//IPFS
app.post('/api/v0/addMetadataToIpfs', websiteOnlyCors, authorizeBlockinRequest, express.json({ limit: '100mb' }), addMetadataToIpfsHandler); //
app.post('/api/v0/addApprovalDetailsToOffChainStorage', websiteOnlyCors, authorizeBlockinRequest, express.json({ limit: '100mb' }), addApprovalDetailsToOffChainStorageHandler); //
app.post('/api/v0/addBalancesToOffChainStorage', websiteOnlyCors, authorizeBlockinRequest, express.json({ limit: '100mb' }), addBalancesToOffChainStorageHandler); //

//Blockin Auth - bitbadges.io only
app.post('/api/v0/auth/getChallenge', getChallenge);
app.post('/api/v0/auth/verify', verifyBlockinAndGrantSessionCookie);
app.post('/api/v0/auth/logout', removeBlockinSessionCookie);
app.post('/api/v0/auth/status', checkifSignedInHandler);
app.post("/api/v0/auth/genericVerify", genericBlockinVerifyHandler);

//Fetch arbitrary metadata - bitbadges.io only
app.post('/api/v0/metadata', websiteOnlyCors, fetchMetadataDirectly);


//Browse
app.post('/api/v0/browse', getBrowseCollections);

//Broadcasting
app.post('/api/v0/broadcast', broadcastTx);
app.post('/api/v0/simulate', simulateTx);


//Faucet
app.post('/api/v0/faucet', authorizeBlockinRequest, getTokensFromFaucet);

//Address Lists
app.post('/api/v0/addressLists', getAddressLists);
app.post('/api/v0/addressLists/update', authorizeBlockinRequest, updateAddressLists);
app.post('/api/v0/addressLists/delete', authorizeBlockinRequest, deleteAddressLists);

//Blockin Auth Codes
app.post('/api/v0/authCode', getAuthCode)
app.post("/api/v0/authCode/create", createAuthCode) //we now verify signature with submitted (message, signature) pair (thus replacing the authorizeBlockinRequest)
app.post("/api/v0/authCode/delete", authorizeBlockinRequest, deleteAuthCode)
app.post('/api/v0/survey/:listId/add', addAddressToSurvey);

//Claim Alerts
app.post('/api/v0/claimAlerts/send', websiteOnlyCors, authorizeBlockinRequest, sendClaimAlert);
app.post('/api/v0/claimAlerts', authorizeBlockinRequest, getClaimAlertsForCollection);

//Follow Protocol
app.post('/api/v0/follow-protocol', getFollowDetails);

//Eth First Tx
app.get('/api/v0/ethFirstTx/:cosmosAddress', getBalancesForEthFirstTx)

//Protocols
app.post('/api/v0/protocols', getProtocols);
app.post('/api/v0/protocols/collection', getCollectionForProtocol);


app.get("/api/v0/verifyEmail/:token", websiteOnlyCors, async (req: Request, res: Response) => {

  try {
    const doc = await ProfileModel.findOne({ "notifications.emailVerification.token": req.params.token }).lean().exec();
    if (!doc) {
      throw new Error('Token not found');
    }

    if (!doc.notifications || !doc.notifications.emailVerification) {
      throw new Error('Token not found');
    }

    if (doc.notifications.emailVerification.verified) {
      throw new Error('Email already verified');
    }

    const expiry = new Date(Number(doc.notifications.emailVerification.expiry) ?? 0);
    if (expiry < new Date()) {
      throw new Error('Token expired');
    }

    const newDoc = {
      ...doc,
      notifications: {
        ...doc.notifications,
        emailVerification: {
          ...doc.notifications.emailVerification,
          verified: true,
          token: undefined,
          expiry: undefined,
        }
      }
    }
    await insertToDB(ProfileModel, newDoc);

    return res.status(200).send({
      success: true
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: "Error verfiying email"
    });
  }
})

//TODO: Simple implementation of a one-way heartbeat mode.
//If the parent process dies, the child process will take over.
//Probably 
const NUM_FAILED_HEARTBEATS_BEFORE_SWITCH = 10;
let numConsecutiveFailedHeartbeats = 0;
const initHeartbeat = async () => {
  const PARENT_PROCESS_URL = process.env.PARENT_PROCESS_URL;
  if (!PARENT_PROCESS_URL) {
    throw new Error('PARENT_PROCESS_URL not set');
  }

  const heartbeat = async () => {
    try {
      await axios.get(PARENT_PROCESS_URL, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.BITBADGES_API_KEY,
        }
      });

      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  }

  const isParentAlive = await heartbeat();
  if (!isParentAlive) {
    numConsecutiveFailedHeartbeats++;
    console.log(`Parent process is dead. Failed heartbeats: ${numConsecutiveFailedHeartbeats} / ${NUM_FAILED_HEARTBEATS_BEFORE_SWITCH}`);

    if (numConsecutiveFailedHeartbeats > NUM_FAILED_HEARTBEATS_BEFORE_SWITCH) {
      console.log('Taking over as parent process.');
      setTimeout(poll, 1)
      return;
    }
  } else {
    console.log('Parent process is alive. Still on standby....');
    numConsecutiveFailedHeartbeats = 0;
  }
  if (SHUTDOWN) return;

  const newTimer = setTimeout(initHeartbeat, 5000);
  setHeartbeatTimer(newTimer);
}


//Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
  if (!OFFLINE_MODE) {
    if (process.env.DISABLE_BLOCKCHAIN_POLLER !== 'true') {
      if (process.env.HEARTBEAT_MODE === 'true') {
        setTimeout(initHeartbeat, 1)
      } else {
        setTimeout(poll, 1)
      }
    }
    if (process.env.DISABLE_URI_POLLER !== 'true') {
      setTimeout(pollUris, 1)
    }

    if (process.env.DISABLE_NOTIFICATION_POLLER !== 'true') {
      setTimeout(pollNotifications, 1)
    }
  }
}


const server = process.env.DISABLE_API === 'true' ? undefined :
  https.createServer(
    {
      key: fs.readFileSync("server.key"),
      cert: fs.readFileSync("server.cert"),
    },
    app
  ).listen(port, () => {
    init().catch(console.error).then(() => {
      console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
    })
  })

// app.listen(port, () => {
//   init().catch(console.error).then(() => {
//     console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
//   })
// })






if (process.env.DISABLE_API === 'true') {
  console.log('API server disabled');
  init().catch(console.error);
}

const gracefullyShutdown = async () => {
  SHUTDOWN = true;
  server?.close(() => {
    console.log("server closed")
  })

  await mongoose.connection.close();
  console.log("mongoose connection closed")

  process.exit(0);
}


process.on('SIGINT', gracefullyShutdown);
process.on('SIGTERM', gracefullyShutdown);