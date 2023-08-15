import cookieParser from 'cookie-parser'
import { Attribute } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import expressSession from 'express-session'
import { Server } from "http"
import { create } from 'ipfs-http-client'
import { authorizeBlockinRequest, checkifSignedInHandler, getChallenge, removeBlockinSessionCookie, verifyBlockinAndGrantSessionCookie } from "./blockin/blockin_handlers"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { poll } from "./poll"
import { addAnnouncement } from './routes/announcements'
import { getBadgeBalanceByAddress } from "./routes/balances"
import { broadcastTx, simulateTx } from './routes/broadcast'
import { getBrowseCollections } from './routes/browse'
import { getAllCodesAndPasswords } from "./routes/codes"
import { getBadgeActivity, getCollectionById, getCollections, getMetadataForCollection, getOwnersForBadge } from "./routes/collections"
import { getTokensFromFaucet } from './routes/faucet'
import { addBalancesToIpfsHandler, addMerkleChallengeToIpfsHandler, addMetadataToIpfsHandler } from "./routes/ipfs"
import { fetchMetadataDirectly, refreshMetadata } from "./routes/metadata"
import { getMerkleChallengeCodeViaPassword } from "./routes/passwords"
import { addReviewForCollection, addReviewForUser } from './routes/reviews'
import { searchHandler } from "./routes/search"
import { getStatusHandler } from "./routes/status"
import { getAccount, getAccounts, updateAccountInfo } from "./routes/users"
import _ from 'environment'
import axios from 'axios'
import { getAddressMappings } from './routes/addressMappings'
import { getApprovals } from './routes/approvalTrackers'
import { getMerkleChallengeTrackers } from './routes/challengeTrackers'
import rateLimit from 'express-rate-limit'
import { ErrorResponse } from 'bitbadgesjs-utils'

var responseTime = require('response-time')

var fs = require("fs");
var https = require("https");
const cors = require('cors');

export const OFFLINE_MODE = false;

axios.defaults.timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000; // Set the default timeout value in milliseconds

config()

// Basic rate limiting middleware for Express. Limits requests to 30 per minute.
// Initially put in place to protect against infinite loops.
const limiter = rateLimit({
  windowMs: 30 * 1000, // 1 minutes
  max: 1000, // Limit each IP to 30 requests per `window` (here, per minute)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const errorResponse: ErrorResponse = {
      message: 'Exceeded rate limit. Too many requests, please try again later.',
    }
    res.status(429).json(errorResponse);
  },

})

const auth = 'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

export const LOAD_BALANCER_ID = Number(process.env.LOAD_BALANCER_ID); //string number

export const ipfsClient = create({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: auth,
  },
  timeout: process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000,
});

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

const app: Express = express()
const port = process.env.port ? Number(process.env.port) : 3001

//TODO: secure these / API keys?
app.use(cors({
  origin: true,
  credentials: true,
}));

var websiteOnlyCorsOptions = {
  //localhost or deployed
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL : 'https://bitbadges.io',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}


//Use limiter but provide a custom error response
app.use(limiter);
// app.use(timeout('30s'));
app.use(responseTime())


app.use(expressSession({
  name: 'blockin',
  secret: process.env['SESSION_SECRET'] ? process.env['SESSION_SECRET'] : '',
  resave: true,
  saveUninitialized: true,
  cookie: { secure: true, sameSite: 'none' }
}));

app.use(cookieParser());

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ limit: '10mb', extended: true }))

// parse application/json
app.use(express.json({ limit: '10mb' }))

app.use((req, res, next) => {
  console.log();
  console.log(req.method, req.url);
  console.log(JSON.stringify(req.body, null, 2));
  next();
});

app.get("/", (req: Request, res: Response) => {
  res.send({
    message: "Hello from the BitBadges indexer!",
  })
})

//Status
app.post("/api/v0/status", getStatusHandler);

//Search
app.post("/api/v0/search/:searchValue", searchHandler);

//Collections
app.post("/api/v0/collection/batch", getCollections)
app.post("/api/v0/collection/:collectionId", getCollectionById)
app.post('/api/v0/collection/:collectionId/:badgeId/owners', getOwnersForBadge);
app.post("/api/v0/collection/:collectionId/metadata", getMetadataForCollection)
app.post('/api/v0/collection/:collectionId/balance/:cosmosAddress', getBadgeBalanceByAddress);
app.post('/api/v0/collection/:collectionId/:badgeId/activity', getBadgeActivity);

app.post('/api/v0/collection/:collectionId/refreshMetadata', refreshMetadata); //Write route

app.post('/api/v0/collection/:collectionId/codes', authorizeBlockinRequest, getAllCodesAndPasswords);
app.post('/api/v0/collection/:collectionId/password/:cid/:password', authorizeBlockinRequest, getMerkleChallengeCodeViaPassword); //Write route

app.post('/api/v0/collection/:collectionId/addAnnouncement', authorizeBlockinRequest, addAnnouncement); //Write route
app.post('/api/v0/collection/:collectionId/addReview', authorizeBlockinRequest, addReviewForCollection); //Write route


//User
app.post('/api/v0/user/batch', getAccounts);
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest, updateAccountInfo); //Write route
app.post('/api/v0/user/:addressOrUsername', getAccount);
app.post('/api/v0/user/:addressOrUsername/addReview', authorizeBlockinRequest, addReviewForUser); //Write route

//IPFS
app.post('/api/v0/addMetadataToIpfs', cors(websiteOnlyCorsOptions), authorizeBlockinRequest, addMetadataToIpfsHandler); //
app.post('/api/v0/addMerkleChallengeToIpfs', cors(websiteOnlyCorsOptions), authorizeBlockinRequest, addMerkleChallengeToIpfsHandler); //
app.post('/api/v0/addBalancesToIpfs', cors(websiteOnlyCorsOptions), authorizeBlockinRequest, addBalancesToIpfsHandler); //

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
app.post('/api/v0/metadata', fetchMetadataDirectly);

//Faucet
app.post('/api/v0/faucet', authorizeBlockinRequest, getTokensFromFaucet);

//Address Mappings
app.post('/api/v0/addressMappings', getAddressMappings);

//Approvals
app.post('/api/v0/approvals', getApprovals);

//Merkle Challenge Tracker
app.post('/api/v0/merkleChallenges', getMerkleChallengeTrackers);


//Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
  if (!OFFLINE_MODE) {
    setTimeout(poll, 1)
  }
}

process.on("SIGINT", () => {
  if (timer) clearTimeout(timer)
  server.close(() => {
    console.log("server closed")
    process.exit(0)
  })
})

const server: Server =
  https.createServer(
    {
      key: fs.readFileSync("server.key"),
      cert: fs.readFileSync("server.cert"),
    },
    app
  )
    .listen(port, () => {
      init().catch(console.error).then(() => {
        console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
      })
    })
