import axios from 'axios'
import { ErrorResponse } from 'bitbadgesjs-utils'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { Attribute } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import rateLimit from 'express-rate-limit'
import expressSession from 'express-session'
import fs from 'fs'
import https from 'https'
import mongoose from 'mongoose'
import Moralis from 'moralis'
import multer from 'multer'
import responseTime from 'response-time'
import { authorizeBlockinRequest, checkifSignedInHandler, genericBlockinVerifyHandler, getChallenge, removeBlockinSessionCookie, verifyBlockinAndGrantSessionCookie } from "./blockin/blockin_handlers"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ApiKeyModel, insertToDB, mustGetFromDB } from './db/db'
import { OFFLINE_MODE, TIME_MODE } from './indexer-vars'
import { poll, pollUris } from "./poll"
import { deleteAddressMappings, getAddressMappings, updateAddressMappings } from './routes/addressMappings'
import { getApprovals } from './routes/approvalTrackers'
import { createAuthCode, deleteAuthCode, getAuthCode } from './routes/authCodes'
import { getOwnersForBadge } from './routes/badges'
import { getBadgeBalanceByAddress } from "./routes/balances"
import { broadcastTx, simulateTx } from './routes/broadcast'
import { getBrowseCollections } from './routes/browse'
import { getChallengeTrackers } from './routes/challengeTrackers'
import { getClaimAlertsForCollection, sendClaimAlert } from './routes/claimAlerts'
import { getAllCodesAndPasswords } from "./routes/codes"
import { getBadgeActivity, getCollectionById, getCollections, getMetadataForCollection, } from "./routes/collections"
import { getBalancesForEthFirstTx } from './routes/ethFirstTx'
import { getTokensFromFaucet } from './routes/faucet'
import { getFollowDetails, updateFollowDetails } from './routes/follows'
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addMetadataToIpfsHandler } from "./routes/ipfs"
import { fetchMetadataDirectly, } from "./routes/metadata"
import { getMerkleChallengeCodeViaPassword } from "./routes/passwords"
import { getRefreshStatus, refreshMetadata } from './routes/refresh'
import { addReport } from './routes/reports'
import { addReviewForCollection, addReviewForUser, deleteReview } from './routes/reviews'
import { searchHandler } from "./routes/search"
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
      message: 'Exceeded rate limit. Too many requests, please try again later.',
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

const upload = multer({ dest: 'uploads/' });
const app: Express = express()
const port = process.env.port ? Number(process.env.port) : 3001

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
        message: 'Unauthorized request. API key is required.',
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
  name: 'blockin',
  secret: process.env['SESSION_SECRET'] ? process.env['SESSION_SECRET'] : '',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'none' }
}));

app.use(cookieParser());

// // parse application/x-www-form-urlencoded
// app.use(express.urlencoded({ limit: '50mb', extended: true }))

// // parse application/json
// app.use(express.json({ limit: '50mb' }))

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
app.post("/api/v0/collection/:collectionId/metadata", getMetadataForCollection)
app.post('/api/v0/collection/:collectionId/balance/:cosmosAddress', getBadgeBalanceByAddress);
app.post('/api/v0/collection/:collectionId/:badgeId/activity', getBadgeActivity);

app.post('/api/v0/collection/:collectionId/refresh', refreshMetadata); //Write route
app.post('/api/v0/collection/:collectionId/refreshStatus', getRefreshStatus); //Write route

app.post('/api/v0/collection/:collectionId/codes', authorizeBlockinRequest, getAllCodesAndPasswords);
app.post('/api/v0/collection/:collectionId/password/:cid/:password', authorizeBlockinRequest, getMerkleChallengeCodeViaPassword); //Write route

app.post('/api/v0/collection/:collectionId/addReview', authorizeBlockinRequest, addReviewForCollection); //Write route

// `/api/v0/collection/${collectionId.toString()}/deleteReview/${reviewId}`;
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

//Blockin Auth
app.post('/api/v0/auth/getChallenge', getChallenge);
app.post('/api/v0/auth/verify', verifyBlockinAndGrantSessionCookie);
app.post('/api/v0/auth/logout', removeBlockinSessionCookie);
app.post('/api/v0/auth/status', checkifSignedInHandler);
app.post("/api/v0/auth/genericVerify", genericBlockinVerifyHandler);

//Browse
app.post('/api/v0/browse', getBrowseCollections);

//Broadcasting
app.post('/api/v0/broadcast', broadcastTx);
app.post('/api/v0/simulate', simulateTx);

//Fetch arbitrary metadata
app.post('/api/v0/metadata', websiteOnlyCors, fetchMetadataDirectly);

//Faucet
app.post('/api/v0/faucet', authorizeBlockinRequest, getTokensFromFaucet);

//Address Mappings
app.post('/api/v0/addressMappings', getAddressMappings);
app.post('/api/v0/addressMappings/update', authorizeBlockinRequest, updateAddressMappings);
app.post('/api/v0/addressMappings/delete', authorizeBlockinRequest, deleteAddressMappings);

//Approvals
app.post('/api/v0/approvals', getApprovals);

//Merkle Challenge Tracker
app.post('/api/v0/challenges', getChallengeTrackers);

//Blockin Auth Codes
app.post('/api/v0/authCode', getAuthCode)
// app.post("/api/v0/authCode/create", authorizeBlockinRequest, createAuthCode)
app.post("/api/v0/authCode/create", createAuthCode) //we now verify signature with submitted (message, signature) pair (thus replacing the authorizeBlockinRequest)
app.post("/api/v0/authCode/delete", authorizeBlockinRequest, deleteAuthCode)

//Surveys
app.post('/api/v0/survey/:mappingId/add', addAddressToSurvey);

//Claim Alerts
app.post('/api/v0/claimAlerts/send', authorizeBlockinRequest, sendClaimAlert);

//Follow Protocol
app.post('/api/v0/follow-protocol/update', authorizeBlockinRequest, updateFollowDetails);
app.post('/api/v0/follow-protocol', getFollowDetails);

app.post('/api/v0/claimAlerts', authorizeBlockinRequest, getClaimAlertsForCollection);
//Set up Moralis

app.get('/api/v0/ethFirstTx/:cosmosAddress', getBalancesForEthFirstTx)



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