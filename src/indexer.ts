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
import multer from 'multer'
import responseTime from 'response-time'
import { authorizeBlockinRequest, checkifSignedInHandler, getChallenge, removeBlockinSessionCookie, verifyBlockinAndGrantSessionCookie } from "./blockin/blockin_handlers"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { API_KEYS_DB, REPORTS_DB, ReportDoc, insertToDB } from './db/db'
import { OFFLINE_MODE, TIME_MODE } from './indexer-vars'
import { poll, pollUris } from "./poll"
import { deleteAddressMappings, getAddressMappings, updateAddressMappings } from './routes/addressMappings'
import { addAnnouncement } from './routes/announcements'
import { getApprovals } from './routes/approvalTrackers'
import { getOwnersForBadge } from './routes/badges'
import { getBadgeBalanceByAddress } from "./routes/balances"
import { broadcastTx, simulateTx } from './routes/broadcast'
import { getBrowseCollections } from './routes/browse'
import { getChallengeTrackers } from './routes/challengeTrackers'
import { getAllCodesAndPasswords } from "./routes/codes"
import { getBadgeActivity, getCollectionById, getCollections, getMetadataForCollection, } from "./routes/collections"
import { getTokensFromFaucet } from './routes/faucet'
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addMetadataToIpfsHandler } from "./routes/ipfs"
import { fetchMetadataDirectly, } from "./routes/metadata"
import { getMerkleChallengeCodeViaPassword } from "./routes/passwords"
import { getRefreshStatus, refreshMetadata } from './routes/refresh'
import { addReviewForCollection, addReviewForUser, deleteAnnouncement, deleteReview } from './routes/reviews'
import { searchHandler } from "./routes/search"
import { getStatusHandler } from "./routes/status"
import { getAccount, getAccounts, updateAccountInfo } from "./routes/users"


axios.defaults.timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000; // Set the default timeout value in milliseconds
config()

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

  // console.log("ORIGIN", origin);

  if (origin && (origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io')) {
    return next();
  } else {
    //Validate API key
    const apiKey = req.headers['x-api-key'];
    try {

      if (!apiKey) {
        throw new Error('Unauthorized request. API key is required.');
      }

      const doc = await API_KEYS_DB.get(apiKey as string);

      const lastRequestWasYesterday = new Date(doc.lastRequest).getDate() !== new Date().getDate();
      if (lastRequestWasYesterday) {
        doc.numRequests = 0;
      }

      if (doc.numRequests > 10000) {
        throw new Error('Unauthorized request. API key has exceeded its request daily limit.');
      }

      await insertToDB(API_KEYS_DB, {
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



app.use(expressSession({
  name: 'blockin',
  secret: process.env['SESSION_SECRET'] ? process.env['SESSION_SECRET'] : '',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, sameSite: 'none' }
}));

app.use(cookieParser());

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// parse application/json
app.use(express.json({ limit: '50mb' }))

// app.use((req, res, next) => {
//   // if (!TIME_MODE) {
//   //   console.log();
//   //   console.log(req.method, req.url);
//   //   console.log(JSON.stringify(req.body, null, 2));
//   // }
//   next();
// });

app.get("/", (req: Request, res: Response) => {
  res.send({
    message: "Hello from the BitBadges indexer! See docs.bitbadges.io for documentation.",
  })
})

//Status
app.post("/api/v0/status", getStatusHandler);

//Reports
app.post("/api/v0/report", cors(websiteOnlyCorsOptions), authorizeBlockinRequest, async (req, res) => {
  try {
    const report = req.body;

    const reportDoc: ReportDoc = {
      collectionId: report.collectionId,
      mappingId: report.mappingId,
      addressOrUsername: report.addressOrUsername,
      reason: report.reason,
    }
    await insertToDB(REPORTS_DB, reportDoc);
    return res.status(200).send({ message: 'Report successfully submitted.' });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ message: e.message });
  }
});

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

app.post('/api/v0/collection/:collectionId/addAnnouncement', authorizeBlockinRequest, addAnnouncement); //Write route
app.post('/api/v0/collection/:collectionId/addReview', authorizeBlockinRequest, addReviewForCollection); //Write route

// `/api/v0/collection/${collectionId.toString()}/deleteReview/${reviewId}`;
app.post('/api/v0/deleteReview/:reviewId', authorizeBlockinRequest, deleteReview); //Write route
app.post('/api/v0/deleteAnnouncement/:announcementId', authorizeBlockinRequest, deleteAnnouncement); //Write route


//User
app.post('/api/v0/user/batch', getAccounts);
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest, upload.single('profilePicImageFile'), updateAccountInfo); //Write route
app.post('/api/v0/user/:addressOrUsername', getAccount);
app.post('/api/v0/user/:addressOrUsername/addReview', authorizeBlockinRequest, addReviewForUser); //Write route

//IPFS
app.post('/api/v0/addMetadataToIpfs', websiteOnlyCors, authorizeBlockinRequest, addMetadataToIpfsHandler); //
app.post('/api/v0/addApprovalDetailsToOffChainStorage', websiteOnlyCors, authorizeBlockinRequest, addApprovalDetailsToOffChainStorageHandler); //
app.post('/api/v0/addBalancesToOffChainStorage', websiteOnlyCors, authorizeBlockinRequest, addBalancesToOffChainStorageHandler); //

//Blockin Auth
app.post('/api/v0/auth/getChallenge', getChallenge);
app.post('/api/v0/auth/verify', verifyBlockinAndGrantSessionCookie);
app.post('/api/v0/auth/logout', removeBlockinSessionCookie);
app.post('/api/v0/auth/status', checkifSignedInHandler);

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

//Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
  if (!OFFLINE_MODE) {
    if (process.env.DISABLE_BLOCKCHAIN_POLLER !== 'true') {
      setTimeout(poll, 1)
    }
    if (process.env.DISABLE_URI_POLLER !== 'true') {
      setTimeout(pollUris, 1)
    }
  }
}

process.on("SIGINT", () => {
  if (timer) clearTimeout(timer)
  server?.close(() => {
    console.log("server closed")
    process.exit(0)
  })
})



let server = process.env.DISABLE_API === 'true' ? undefined :
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
