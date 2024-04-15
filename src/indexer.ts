import axios from 'axios';
import { NotificationPreferences, SocialConnectionInfo, SocialConnections, type ErrorResponse } from 'bitbadgesjs-sdk';
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
import OAuthPkg from 'oauth';
import passport from 'passport';
import passportDiscord from 'passport-discord';
import passportGithub from 'passport-github';
import passportGoogle from 'passport-google-oauth20';
import querystring from 'querystring';
import responseTime from 'response-time';
import { serializeError } from 'serialize-error';
import {
  type BlockinSession,
  authorizeBlockinRequest,
  checkifSignedInHandler,
  genericBlockinVerifyHandler,
  getChallenge,
  removeBlockinSessionCookie,
  verifyBlockinAndGrantSessionCookie
} from './blockin/blockin_handlers';
import { type IndexerStargateClient } from './chain-client/indexer_stargateclient';
import { insertToDB, mustGetFromDB } from './db/db';
import { findInDB } from './db/queries';
import { ApiKeyModel, ExternalCallKeysModel, ProfileModel } from './db/schemas';
import { OFFLINE_MODE } from './indexer-vars';
import { poll, pollNotifications, pollUris } from './poll';
import { createAddressLists, deleteAddressLists, getAddressLists, updateAddressLists } from './routes/addressLists';
import { createAuthCode, deleteAuthCode, getAuthCode } from './routes/authCodes';
import { getOwnersForBadge } from './routes/badges';
import { getBadgeBalanceByAddress } from './routes/balances';
import { broadcastTx, simulateTx } from './routes/broadcast';
import { getBrowseCollections } from './routes/browse';
import { getClaimAlertsForCollection, sendClaimAlert } from './routes/claimAlerts';
import { checkAndCompleteClaim, getClaimsHandler } from './routes/claims';
import { getBadgeActivity, getCollections } from './routes/collections';
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
import { addReviewForCollection, addReviewForUser, deleteReview } from './routes/reviews';
import { filterBadgesInCollectionHandler, searchHandler } from './routes/search';
import { getStatusHandler } from './routes/status';
import { getAccounts, updateAccountInfo } from './routes/users';

const OAuth = OAuthPkg.OAuth;

const DiscordStrategy = passportDiscord.Strategy;
const GitHubStrategy = passportGithub.Strategy;
const GoogleStrategy = passportGoogle.Strategy;

const scopes = ['identify', 'guilds', 'guilds.members.read'];

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackURL: process.env.DEV_MODE === 'true' ? 'https://localhost:3001/auth/google/callback' : 'https://api.bitbadges.io/auth/google/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.emails ? profile.emails[0].value : ''
      };
      return cb(null, user);
    }
  )
);

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.CLIENT_ID ?? '',
      clientSecret: process.env.CLIENT_SECRET ?? '',
      callbackURL:
        process.env.DEV_MODE === 'true' ? 'https://localhost:3001/auth/discord/callback' : 'https://api.bitbadges.io/auth/discord/callback',
      scope: scopes
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.username,
        discriminator: profile.discriminator,
        access_token: accessToken
      };
      return cb(null, user);
    }
  )
);

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      callbackURL: process.env.DEV_MODE === 'true' ? 'https://localhost:3001/auth/github/callback' : 'https://api.bitbadges.io/auth/github/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.username
      };

      return cb(null, user);
    }
  )
);

passport.serializeUser(function (user, cb) {
  process.nextTick(function () {
    return cb(null, user);
  });
});

passport.deserializeUser(function (user, cb) {
  process.nextTick(function () {
    return cb(null, user as Express.User);
  });
});

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

// app.use((req, res, next) => {
//   // if (!TIME_MODE) {
//   //   console.log();
//   //   console.log(req.method, req.url);
//   //   console.log(JSON.stringify(req.body, null, 2));
//   // }
//   next();
// });

app.get('/', (req: Request, res: Response) => {
  return res.send({
    message: 'Hello from the BitBadges indexer! See docs.bitbadges.io for documentation.'
  });
});
// Status
app.post('/api/v0/status', getStatusHandler);

/**
 * This is to handle setting session in storage NOT for authenticating a request.
 *
 * We don't use the default setup because it overwrites our Blockin sessions.
 */
const discordCallbackHandler = (req: Request, res: Response, next: Function) => {
  passport.authenticate('discord', async function (err: Error, user: any) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized. No user found.');
    }

    (req.session as BlockinSession<bigint>).discord = user;
    req.session.save();

    if (req.session && (req.session as BlockinSession<bigint>).cosmosAddress) {
      const profileDoc = await mustGetFromDB(ProfileModel, (req.session as BlockinSession<bigint>).cosmosAddress!);
      profileDoc.socialConnections = new SocialConnections({
        ...profileDoc.socialConnections,
        discord: new SocialConnectionInfo({
          discriminator: user.discriminator,
          username: user.username,
          id: user.id,
          lastUpdated: BigInt(Date.now())
        })
      });
      await insertToDB(ProfileModel, profileDoc);
    }

    return res.status(200).send('Logged in. Please proceed back to the app.');
  })(req, res, next);
};

app.get('/auth/discord', passport.authenticate('discord', { session: false }));
app.get('/auth/discord/callback', discordCallbackHandler);

const redditConfig = {
  clientID: process.env.REDDIT_CLIENT_ID || '',
  clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  callbackURL: process.env.DEV_MODE === 'true' ? 'https://localhost:3001/auth/reddit/callback' : 'https://api.bitbadges.io/auth/reddit/callback'
};

const redditOauth = new OAuth(
  'https://www.reddit.com/api/v1/access_token',
  'https://www.reddit.com/api/v1/authorize',
  redditConfig.clientID,
  redditConfig.clientSecret,
  '1.0A',
  redditConfig.callbackURL,
  'HMAC-SHA1'
);

app.get('/auth/reddit', (_req, res) => {
  try {
    return redditOauth.getOAuthRequestToken((error, oauthToken, oauthTokenSecret) => {
      if (error) {
        console.error('Error getting OAuth request token:', error);
        return res.status(500).send('Error getting OAuth request token');
      } else {
        // Redirect the user to Reddit authentication page
        return res.redirect(
          `https://www.reddit.com/api/v1/authorize?client_id=${redditConfig.clientID}&response_type=code&state=${oauthToken}&redirect_uri=${redditConfig.callbackURL}&duration=permanent&scope=identity`
        );
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

app.get('/auth/reddit/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;

    const oauthParams = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redditConfig.callbackURL
    };

    const oauthRes = await axios.post('https://www.reddit.com/api/v1/access_token', null, {
      params: oauthParams,
      auth: {
        username: redditConfig.clientID,
        password: redditConfig.clientSecret
      }
    });

    const data = oauthRes.data;

    const accessToken = data.access_token as string;

    // Get user's Reddit profile
    const userProfileUrl = 'https://oauth.reddit.com/api/v1/me';
    return redditOauth.get(userProfileUrl, accessToken, '', (error, data) => {
      if (error) {
        console.error('Error getting Reddit profile:', error);
        return res.status(500).send('Error getting Reddit profile');
      } else {
        const profile = JSON.parse(data as any);
        const user = {
          id: profile.id,
          username: profile.name,
          access_token: accessToken
        };

        (req.session as BlockinSession<bigint>).reddit = user;
        req.session.save();

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

const twitterConfig = {
  consumerKey: process.env.TWITTER_CONSUMER_KEY || '',
  consumerSecret: process.env.TWITTER_CONSUMER_SECRET || '',
  callbackURL: process.env.DEV_MODE === 'true' ? 'https://localhost:3001/auth/twitter/callback' : 'https://api.bitbadges.io/auth/twitter/callback'
};

const oauthRequestTokenUrl = 'https://api.twitter.com/oauth/request_token';
const twitterOauth = new OAuth(
  oauthRequestTokenUrl,
  'https://api.twitter.com/oauth/access_token',
  twitterConfig.consumerKey,
  twitterConfig.consumerSecret,
  '1.0A',
  twitterConfig.callbackURL,
  'HMAC-SHA1'
);

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

const githubCallbackHandler = (req: Request, res: Response, next: Function) => {
  passport.authenticate('github', async function (err: Error, user: any) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized. No user found.');
    }

    (req.session as BlockinSession<bigint>).github = user;
    req.session.save();

    if (req.session && (req.session as BlockinSession<bigint>).cosmosAddress) {
      const profileDoc = await mustGetFromDB(ProfileModel, (req.session as BlockinSession<bigint>).cosmosAddress!);
      profileDoc.socialConnections = new SocialConnections({
        ...profileDoc.socialConnections,
        github: new SocialConnectionInfo({
          username: user.username,
          id: user.id,
          lastUpdated: BigInt(Date.now())
        })
      });
      await insertToDB(ProfileModel, profileDoc);
    }

    return res.status(200).send('Logged in. Please proceed back to the app.');
  })(req, res, next);
};

app.get('/auth/github', passport.authenticate('github', { session: false }));
app.get('/auth/github/callback', githubCallbackHandler);

const redditCallbackHandler = (req: Request, res: Response, next: Function) => {
  passport.authenticate('reddit', function (err: Error, user: any) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized. No user found.');
    }

    (req.session as BlockinSession<bigint>).reddit = user;
    req.session.save();

    return res.status(200).send('Logged in. Please proceed back to the app.');
  })(req, res, next);
};

app.get('/auth/reddit', passport.authenticate('reddit', { session: false }));
app.get('/auth/reddit/callback', redditCallbackHandler);

const googleCallbackHandler = (req: Request, res: Response, next: Function) => {
  passport.authenticate('google', async function (err: Error, user: any) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).send('Unauthorized. No user found.');
    }

    (req.session as BlockinSession<bigint>).google = user;
    req.session.save();

    if (req.session && (req.session as BlockinSession<bigint>).cosmosAddress) {
      const profileDoc = await mustGetFromDB(ProfileModel, (req.session as BlockinSession<bigint>).cosmosAddress!);
      profileDoc.socialConnections = new SocialConnections({
        ...profileDoc.socialConnections,
        google: new SocialConnectionInfo({
          username: user.username,
          id: user.id,
          lastUpdated: BigInt(Date.now())
        })
      });
      await insertToDB(ProfileModel, profileDoc);
    }

    return res.status(200).send('Logged in. Please proceed back to the app.');
  })(req, res, next);
};

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

app.post('/api/v0/collection/:collectionId/addReview', authorizeBlockinRequest(['Reviews']), addReviewForCollection); // Write route
app.post('/api/v0/deleteReview/:reviewId', authorizeBlockinRequest(['Reviews']), deleteReview); // Write route

// User
app.post('/api/v0/user/batch', getAccounts);
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest(['Profile']), upload.single('profilePicImageFile'), updateAccountInfo); // Write route
app.post('/api/v0/user/:addressOrUsername/addReview', authorizeBlockinRequest(['Reviews']), addReviewForUser); // Write route

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

app.post('/api/v0/externalCallKey', async (req: Request, res: Response) => {
  try {
    const uri = req.body.uri;
    if (!uri) {
      throw new Error('uri is required');
    }

    const key = req.body.key;
    if (!key) {
      throw new Error('key is required');
    }

    const keysDoc = await mustGetFromDB(ExternalCallKeysModel, uri);

    const matchingKey = keysDoc.keys.find((k) => k.key === key);
    if (!matchingKey) {
      throw new Error('Key not found');
    }

    return res.status(200).send({
      timestamp: matchingKey.timestamp,
      key: matchingKey.key
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
});

app.get('/api/v0/unsubscribe/:token', async (req: Request, res: Response) => {
  try {
    const docs = await findInDB(ProfileModel, {
      query: { 'notifications.emailVerification.token': req.params.token }
    });
    const doc = docs.length > 0 ? docs[0] : undefined;
    if (!doc) {
      throw new Error('Token not found');
    }

    const newDoc = {
      ...doc,
      notifications: new NotificationPreferences({})
    };

    await insertToDB(ProfileModel, newDoc);

    return res.status(200).send({
      success: true
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
});

app.get('/api/v0/verifyEmail/:token', websiteOnlyCors, async (req: Request, res: Response) => {
  try {
    const docs = await findInDB(ProfileModel, {
      query: { 'notifications.emailVerification.token': req.params.token }
    });
    const doc = docs.length > 0 ? docs[0] : undefined;

    if (!doc) {
      throw new Error('Token not found');
    }

    if (!doc.notifications?.emailVerification) {
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
          expiry: undefined
        }
      }
    };
    await insertToDB(ProfileModel, newDoc);

    return res.status(200).send({
      success: true
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
});

// TODO: Simple implementation of a one-way heartbeat mode.
// If the parent process dies, the child process will take over.
// Probably
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
          'Content-Type': 'application/json',
          'x-api-key': process.env.BITBADGES_API_KEY
        }
      });

      return true;
    } catch (e) {
      console.log(e);
      return false;
    }
  };

  const isParentAlive = await heartbeat();
  if (!isParentAlive) {
    numConsecutiveFailedHeartbeats++;
    console.log(`Parent process is dead. Failed heartbeats: ${numConsecutiveFailedHeartbeats} / ${NUM_FAILED_HEARTBEATS_BEFORE_SWITCH}`);

    if (numConsecutiveFailedHeartbeats > NUM_FAILED_HEARTBEATS_BEFORE_SWITCH) {
      console.log('Taking over as parent process.');
      setTimeout(poll, 1);
      return;
    }
  } else {
    console.log('Parent process is alive. Still on standby....');
    numConsecutiveFailedHeartbeats = 0;
  }
  if (SHUTDOWN) return;

  const newTimer = setTimeout(initHeartbeat, 5000);
  setHeartbeatTimer(newTimer);
};

// Initialize the poller which polls the blockchain every X seconds and updates the database
const init = async () => {
  if (!OFFLINE_MODE) {
    if (process.env.DISABLE_BLOCKCHAIN_POLLER !== 'true') {
      if (process.env.HEARTBEAT_MODE === 'true') {
        setTimeout(initHeartbeat, 1);
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
