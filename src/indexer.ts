import { Mutex } from 'async-mutex'
import cookieParser from 'cookie-parser'
import { Attribute } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import { config } from "dotenv"
import express, { Express, Request, Response } from "express"
import expressSession from 'express-session'
import { Server } from "http"
import { create } from 'ipfs-http-client'
import { authorizeBlockinRequest, getChallenge, removeBlockinSessionCookie, verifyBlockinAndGrantSessionCookie } from "./blockin/blockin_handlers"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { poll } from "./poll"
import { getBadgeBalance } from "./routes/balances"
import { getCodes } from "./routes/codes"
import { getCollectionById, getCollections, getMetadataForCollection, getOwnersForCollection, queryCollections } from "./routes/collections"
import { addMerkleTreeToIpfsHandler, addToIpfsHandler } from "./routes/ipfs"
import { getPasswordsAndCodes } from "./routes/passwords"
import { fetchMetadata, refreshMetadata } from "./routes/metadata"
import { searchHandler } from "./routes/search"
import { getStatusHandler } from "./routes/status"
import { getAccountByAddress, getAccountById, getBatchUsers, getPortfolioInfo } from "./routes/users"
import _ from "../environment"

const cors = require('cors');

// create a mutex for synchronizing access to the queue
export const refreshQueueMutex = new Mutex();


config()

const auth = 'Basic ' + Buffer.from(process.env.INFURA_ID + ':' + process.env.INFURA_SECRET_KEY).toString('base64');

export const ipfsClient = create({
    host: 'ipfs.infura.io',
    port: 5001,
    protocol: 'https',
    headers: {
        authorization: auth,
    },
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
const port = "3001"

// app.use(cors());
//TODO: secure these / API keys? + rate-limit
//nano-cookies?
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
}));

app.use(expressSession({
    name: 'blockin',
    secret: process.env['SESSION_SECRET'] ? process.env['SESSION_SECRET'] : '',
    resave: true,
    saveUninitialized: true,
    cookie: { secure: false, sameSite: false }
}));

app.use(cookieParser());

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ limit: '10mb', extended: true }))

// parse application/json
app.use(express.json({ limit: '10mb' }))

app.use((req, res, next) => {
    console.log();
    console.log(req.method, req.url, req.body);
    next();
});

app.get("/", (req: Request, res: Response) => {
    res.send({
        message: "Hello from the BitBadges indexer!",
    })
})

//TODO: clean route names and methods
app.get("/api/status", getStatusHandler);
app.get("/api/search/:searchValue", searchHandler);
app.get("/api/collection/:id", getCollectionById)
app.post("/api/collection/batch", getCollections)
app.get("/api/collection/query", queryCollections)
app.post("/api/metadata/:collectionId", getMetadataForCollection)
app.get('/api/collection/:id/:badgeId/owners', getOwnersForCollection);
app.get('/api/balance/:collectionId/:accountNum', getBadgeBalance);
app.post('/api/addToIpfs', addToIpfsHandler);
app.post('/api/addMerkleTreeToIpfs', addMerkleTreeToIpfsHandler);
app.get('/api/user/id/:accountNum', getAccountById);
app.get('/api/user/address/:address', getAccountByAddress);
app.post('/api/getChallengeParams', getChallenge);
app.post('/api/verifyChallenge', verifyBlockinAndGrantSessionCookie);
app.post('/api/logout', removeBlockinSessionCookie);
app.post('/auth/test', authorizeBlockinRequest);
app.post('/api/user/batch', getBatchUsers);

app.get('/api/user/portfolio/:accountNum', getPortfolioInfo);
app.get('/api/collection/codes/:collectionId', authorizeBlockinRequest, getCodes);

app.post('/api/metadata', fetchMetadata);

//IMPORTANT: These routes actually update documents and require control of a mutex (see implementations).
app.post('/api/collection/refreshMetadata', refreshMetadata);
app.get('/api/password/:cid/:password', authorizeBlockinRequest, getPasswordsAndCodes);

//Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
    setTimeout(poll, 1)
}

process.on("SIGINT", () => {
    if (timer) clearTimeout(timer)
    server.close(() => {
        console.log("server closed")
        process.exit(0)
    })
})

const server: Server = app.listen(port, () => {
    init().catch(console.error).then(() => {
        console.log(`\nserver started at http://localhost:${port}`)
    })
})
