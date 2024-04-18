import axios from 'axios';
import { SocialConnectionInfo, SocialConnections, type ErrorResponse } from 'bitbadgesjs-sdk';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { type Attribute } from 'cosmjs-types/cosmos/base/abci/v1beta1/abci';
import { config } from 'dotenv';
import express, { type Express, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import expressSession from 'express-session';
import fs from 'fs';
import https from 'https';
import mongoose from 'mongoose';
import Moralis from 'moralis';
import multer from 'multer';
import passport from 'passport';
import querystring from 'querystring';
import responseTime from 'response-time';
import { serializeError } from 'serialize-error';
import {
  authorizeBlockinRequest,
  checkifSignedInHandler,
  genericBlockinVerifyHandler,
  getChallenge,
  removeBlockinSessionCookie,
  verifyBlockinAndGrantSessionCookie,
  type BlockinSession
} from './blockin/blockin_handlers';
import { type IndexerStargateClient } from './chain-client/indexer_stargateclient';
import { insertToDB, mustGetFromDB } from './db/db';
import { ApiKeyModel, ProfileModel } from './db/schemas';
import { OFFLINE_MODE } from './indexer-vars';
import { discordCallbackHandler, githubCallbackHandler, googleCallbackHandler, twitterConfig, twitterOauth } from './oauth';
import { poll, pollNotifications, pollUris } from './poll';
import { createAddressLists, deleteAddressLists, getAddressLists, updateAddressLists } from './routes/addressLists';
import { createAuthCode, deleteAuthCode, getAuthCode } from './routes/authCodes';
import { getOwnersForBadge } from './routes/badges';
import { getBadgeBalanceByAddress } from './routes/balances';
import { broadcastTx, simulateTx } from './routes/broadcast';
import { getBrowseCollections } from './routes/browse';
import { getClaimAlertsForCollection, sendClaimAlert } from './routes/claimAlerts';
import { checkAndCompleteClaim, externalApiCallKeyCheckHandler, getClaimsHandler } from './routes/claims';
import { getBadgeActivity, getCollections } from './routes/collections';
import { unsubscribeHandler, verifyEmailHandler } from './routes/email';
import { getBalancesForEthFirstTx } from './routes/ethFirstTx';
import { getTokensFromFaucet } from './routes/faucet';
import { getFollowDetails } from './routes/follows';
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addMetadataToIpfsHandler } from './routes/ipfs';
import { getMaps } from './routes/maps';
import { fetchMetadataDirectly } from './routes/metadata';
import { createSecret, deleteSecret, getSecret, updateSecret } from './routes/offChainSecrets';
import { createPass } from './routes/pass';
import { getRefreshStatus, refreshMetadata } from './routes/refresh';
import { addReport } from './routes/reports';
import { addReview, deleteReview } from './routes/reviews';
import { filterBadgesInCollectionHandler, searchHandler } from './routes/search';
import { getStatusHandler } from './routes/status';
import { getAccounts, updateAccountInfo } from './routes/users';

axios.defaults.timeout = process.env.FETCH_TIMEOUT ? Number(process.env.FETCH_TIMEOUT) : 30000; // Set the default timeout value in milliseconds
config();

Moralis.start({
  apiKey: process.env.MORALIS_API_KEY
}).catch(console.error);

// Basic rate limiting middleware for Express. Limits requests to 30 per minute.
// Initially put in place to protect against infinite loops.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minutes
  max: 100, // Limit each IP to 30 requests per `window` (here, per minute)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    const errorResponse: ErrorResponse = {
      errorMessage: 'Exceeded rate limit. Too many requests,'
    };
    res.status(429).json(errorResponse);
  }
});

export let SHUTDOWN = false;
export const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value;
};

export let client: IndexerStargateClient;
export const setClient = (newClient: IndexerStargateClient) => {
  client = newClient;
};

export let timer: NodeJS.Timer | undefined;
export const setTimer = (newTimer: NodeJS.Timer) => {
  timer = newTimer;
};

export let uriPollerTimer: NodeJS.Timer | undefined;
export const setUriPollerTimer = (newTimer: NodeJS.Timer) => {
  uriPollerTimer = newTimer;
};

export let heartbeatTimer: NodeJS.Timer | undefined;
export const setHeartbeatTimer = (newTimer: NodeJS.Timer) => {
  heartbeatTimer = newTimer;
};

export let notificationPollerTimer: NodeJS.Timer | undefined;
export const setNotificationPollerTimer = (newTimer: NodeJS.Timer) => {
  notificationPollerTimer = newTimer;
};

const upload = multer({ dest: 'uploads/' });
const app: Express = express();
const port = process.env.port ? Number(process.env.port) : 3001;
app.set('trust proxy', 1);

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(async (req, res, next) => {
  // Check if trusted origin

  const origin = req.headers.origin;
  if (origin && (origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io')) {
    next();
    return;
  } else if (
    req.path.startsWith('/auth/discord') ||
    req.path.startsWith('/auth/twitter') ||
    req.path.startsWith('/auth/github') ||
    req.path.startsWith('/auth/google') ||
    req.path.startsWith('/auth/reddit') ||
    req.path.startsWith('/api/v0/unsubscribe')
  ) {
    next();
    return;
  } else {
    // Validate API key
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

      next();
      return;
    } catch (error) {
      console.log(error);
    }
  }

  const errorResponse: ErrorResponse = {
    errorMessage: 'Unauthorized request. API key is required.'
  };
  return res.status(401).json(errorResponse);
});

const websiteOnlyCorsOptions = {
  // localhost or deployed

  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL : 'https://bitbadges.io',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};
const websiteOnlyCors = cors(websiteOnlyCorsOptions);

// Use limiter but provide a custom error response
app.use(limiter);
// app.use(timeout('30s'));
// console.log the repsonse
app.use(responseTime({ suffix: false }));

app.use(express.json({ limit: '100mb' }));

app.use(
  expressSession({
    proxy: true,
    name: 'blockin',
    secret: process.env.SESSION_SECRET ? process.env.SESSION_SECRET : '',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: 'none'
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

app.get('/auth/discord', passport.authenticate('discord', { session: false }));
app.get('/auth/discord/callback', discordCallbackHandler);

// Twitter authentication route
app.get('/auth/twitter', (_req, res) => {
  try {
    return twitterOauth.getOAuthRequestToken((error, oauthToken, oauthTokenSecret) => {
      if (error) {
        console.error('Error getting OAuth request token:', error);
        return res.status(500).send('Error getting OAuth request token');
      } else {
        // Redirect the user to Twitter authentication page
        return res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
});

// Twitter callback route
app.get('/auth/twitter/callback', async (req, res) => {
  try {
    const oauthAccessTokenUrl = 'https://api.twitter.com/oauth/access_token';
    const oauthVerifier = req.query.oauth_verifier;

    const oauthParams = {
      oauth_consumer_key: twitterConfig.consumerKey,
      oauth_token: req.query.oauth_token,
      oauth_verifier: oauthVerifier
    };

    const oauthRes = await axios.post(oauthAccessTokenUrl, null, {
      params: oauthParams
    });

    const data = querystring.parse(oauthRes.data);

    const accessToken = data.oauth_token as string;
    const accessTokenSecret = data.oauth_token_secret as string;

    // Get user's Twitter profile
    const userProfileUrl = 'https://api.twitter.com/1.1/account/verify_credentials.json';
    return twitterOauth.get(userProfileUrl, accessToken, accessTokenSecret, async (error, data) => {
      if (error) {
        console.error('Error getting Twitter profile:', error);
        return res.status(500).send('Error getting Twitter profile');
      } else {
        const profile = JSON.parse(data as any);
        const user = {
          id: profile.id_str,
          username: profile.screen_name,
          access_token: accessToken,
          access_token_secret: accessTokenSecret
        };

        (req.session as BlockinSession<bigint>).twitter = user;
        req.session.save();

        if (req.session && (req.session as BlockinSession<bigint>).cosmosAddress) {
          const profileDoc = await mustGetFromDB(ProfileModel, (req.session as BlockinSession<bigint>).cosmosAddress!);
          profileDoc.socialConnections = new SocialConnections({
            ...profileDoc.socialConnections,
            twitter: new SocialConnectionInfo({
              username: user.username,
              id: user.id,
              lastUpdated: BigInt(Date.now())
            })
          });
          await insertToDB(ProfileModel, profileDoc);
        }

        return res.status(200).send('Logged in. Please proceed back to the app.');
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
});

app.get('/auth/github', passport.authenticate('github', { session: false }));
app.get('/auth/github/callback', githubCallbackHandler);

app.get('/auth/google', passport.authenticate('google', { session: false, scope: ['profile', 'email'] }));
app.get('/auth/google/callback', googleCallbackHandler);

// Reports
app.post('/api/v0/report', authorizeBlockinRequest(['Report']), addReport);

// Search
app.post('/api/v0/search/:searchValue', searchHandler);

// Collections
app.post('/api/v0/collection/batch', getCollections);
app.post('/api/v0/collection/:collectionId/:badgeId/owners', getOwnersForBadge);
app.post('/api/v0/collection/:collectionId/balance/:cosmosAddress', getBadgeBalanceByAddress);
app.post('/api/v0/collection/:collectionId/:badgeId/activity', getBadgeActivity);

app.post('/api/v0/collection/:collectionId/refresh', refreshMetadata); // Write route
app.post('/api/v0/collection/:collectionId/refreshStatus', getRefreshStatus); // Write route

app.post('/api/v0/claims/:claimId/:cosmosAddress', checkAndCompleteClaim); // Write route
app.post('/api/v0/claims', getClaimsHandler);
app.post('/api/v0/collections/filter', filterBadgesInCollectionHandler);

//Reviews
app.post('/api/v0/reviews/add', authorizeBlockinRequest(['Reviews']), addReview); // Write route
app.post('/api/v0/reviews/delete/:reviewId', authorizeBlockinRequest(['Reviews']), deleteReview); // Write route
app.post('/api/v0/deleteReview/:reviewId', authorizeBlockinRequest(['Reviews']), deleteReview); // Write route

// User
app.post('/api/v0/user/batch', getAccounts);
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest(['Profile']), upload.single('profilePicImageFile'), updateAccountInfo); // Write route

// IPFS
app.post(
  '/api/v0/addMetadataToIpfs',
  websiteOnlyCors,
  authorizeBlockinRequest(['Full Access']),
  express.json({ limit: '100mb' }),
  addMetadataToIpfsHandler
); //
app.post(
  '/api/v0/addApprovalDetailsToOffChainStorage',
  websiteOnlyCors,
  authorizeBlockinRequest(['Full Access']),
  express.json({ limit: '100mb' }),
  addApprovalDetailsToOffChainStorageHandler
); //
app.post(
  '/api/v0/addBalancesToOffChainStorage',
  websiteOnlyCors,
  authorizeBlockinRequest(['Full Access']),
  express.json({ limit: '100mb' }),
  addBalancesToOffChainStorageHandler
); //

// Blockin Auth - bitbadges.io only
app.post('/api/v0/auth/getChallenge', getChallenge);
app.post('/api/v0/auth/verify', verifyBlockinAndGrantSessionCookie);
app.post('/api/v0/auth/logout', removeBlockinSessionCookie);
app.post('/api/v0/auth/status', checkifSignedInHandler);
app.post('/api/v0/auth/genericVerify', genericBlockinVerifyHandler);

// Fetch arbitrary metadata - bitbadges.io only
app.post('/api/v0/metadata', websiteOnlyCors, fetchMetadataDirectly);

// Browse
app.post('/api/v0/browse', getBrowseCollections);

// Broadcasting
app.post('/api/v0/broadcast', broadcastTx);
app.post('/api/v0/simulate', simulateTx);

// Faucet
app.post('/api/v0/faucet', authorizeBlockinRequest(['Full Access']), getTokensFromFaucet);

// Address Lists
app.post('/api/v0/addressLists', getAddressLists);
app.post('/api/v0/addressLists/create', authorizeBlockinRequest(['Address Lists']), createAddressLists);
app.post('/api/v0/addressLists/update', authorizeBlockinRequest(['Address Lists']), updateAddressLists);
app.post('/api/v0/addressLists/delete', authorizeBlockinRequest(['Address Lists']), deleteAddressLists);

// Blockin Auth Codes
app.post('/api/v0/authCode', getAuthCode);
app.post('/api/v0/authCode/create', createAuthCode); // we now verify signature with submitted (message, signature) pair (thus replacing the authorizeBlockinRequest(['Full Access']))
app.post('/api/v0/authCode/delete', authorizeBlockinRequest(['Auth Codes']), deleteAuthCode);

// Claim Alerts
app.post('/api/v0/claimAlerts/send', websiteOnlyCors, authorizeBlockinRequest(['Claim Alerts']), sendClaimAlert);
app.post('/api/v0/claimAlerts', authorizeBlockinRequest(['Claim Alerts']), getClaimAlertsForCollection);

// Follow Protocol
app.post('/api/v0/follow-protocol', getFollowDetails);

// Eth First Tx
app.get('/api/v0/ethFirstTx/:cosmosAddress', getBalancesForEthFirstTx);

// Maps
app.post('/api/v0/maps', getMaps);

app.post('/api/v0/appleWalletPass', createPass);

// Off-Chain Secret Sigs
app.post('/api/v0/secret', getSecret);
app.post('/api/v0/secret/create', authorizeBlockinRequest(['Secrets']), createSecret);
app.post('/api/v0/secret/delete', authorizeBlockinRequest(['Secrets']), deleteSecret);
app.post('/api/v0/secret/update', authorizeBlockinRequest(['Secrets']), updateSecret);

app.post('/api/v0/externalCallKey', externalApiCallKeyCheckHandler);

app.get('/api/v0/unsubscribe/:token', unsubscribeHandler);
app.get('/api/v0/verifyEmail/:token', websiteOnlyCors, verifyEmailHandler);

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

export const server =
  process.env.DISABLE_API === 'true'
    ? undefined
    : https
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
              console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
            })
            .catch(console.error);
        });

// app.listen(port, () => {
//   init().catch(console.error).then(() => {
//     console.log(`\nserver started at http://localhost:${port}`, Date.now().toLocaleString());
//   })
// })

if (process.env.DISABLE_API === 'true') {
  console.log('API server disabled');
  init().catch(console.error);
}

export const gracefullyShutdown = async () => {
  SHUTDOWN = true;
  server?.close(() => {
    console.log('server closed');
  });

  await mongoose.connection.close();
  console.log('mongoose connection closed');

  if (timer) {
    clearTimeout(timer);
  }

  if (uriPollerTimer) {
    clearTimeout(uriPollerTimer);
  }

  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
  }

  if (notificationPollerTimer) {
    clearTimeout(notificationPollerTimer);
  }
};

process.on('SIGINT', gracefullyShutdown);
process.on('SIGTERM', gracefullyShutdown);

export default app;
