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
import {
  NumberType,
  OauthAuthorizePayload,
  OauthTokenPayload,
  SocialConnectionInfo,
  SocialConnections,
  iAccessTokenDoc,
  iAuthorizationCodeDoc,
  mustConvertToCosmosAddress,
  type ErrorResponse
} from 'bitbadgesjs-sdk';
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
import querystring from 'querystring';
import responseTime from 'response-time';
import { serializeError } from 'serialize-error';
import validator from 'validator';
import { discordCallbackHandler, githubCallbackHandler, googleCallbackHandler, twitterConfig, twitterOauth } from './auth/oauth';
import {
  AuthenticatedRequest,
  authorizeBlockinRequest,
  checkifSignedInHandler,
  genericBlockinVerifyAssetsHandler,
  genericBlockinVerifyHandler,
  getChallenge,
  mustGetAuthDetails,
  removeBlockinSessionCookie,
  verifyBlockinAndGrantSessionCookie,
  type BlockinSession
} from './blockin/blockin_handlers';
import { deleteMany, getFromDB, insertToDB, mustGetFromDB, mustGetManyFromDB } from './db/db';
import { findInDB } from './db/queries';
import { AccessTokenModel, ApiKeyModel, AuthorizationCodeModel, DeveloperAppModel, ProfileModel } from './db/schemas';
import { OFFLINE_MODE, client } from './indexer-vars';
import { connectToRpc, poll, pollNotifications, pollUris } from './poll';
import { createAddressLists, deleteAddressLists, getAddressLists, updateAddressLists } from './routes/addressLists';
import { createDeveloperApp, deleteDeveloperApp, getDeveloperApps, updateDeveloperApp } from './routes/authApps';
import { createSIWBBRequest, deleteSIWBBRequest, getAndVerifySIWBBRequest, getSIWBBRequestsForDeveloperApp } from './routes/authCodes';
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
import { unsubscribeHandler, verifyEmailHandler } from './routes/email';
import { getBalancesForEthFirstTx } from './routes/ethFirstTx';
import { getTokensFromFaucet } from './routes/faucet';
import { getFollowDetails } from './routes/follows';
import { addApprovalDetailsToOffChainStorageHandler, addBalancesToOffChainStorageHandler, addToIpfsHandler } from './routes/ipfs';
import { getMaps } from './routes/maps';
import { fetchMetadataDirectly } from './routes/metadata';
import { createAttestation, deleteAttestation, getAttestation, updateAttestation } from './routes/offChainSecrets';
import { createPass } from './routes/pass';
import { createPlugin, deletePlugin, getPlugins, updatePlugin } from './routes/plugins';
import { getRefreshStatus, refreshMetadata } from './routes/refresh';
import { addReport } from './routes/reports';
import { addReview, deleteReview } from './routes/reviews';
import { filterBadgesInCollectionHandler, getFilterSuggestionsHandler, searchHandler, typiaError } from './routes/search';
import { getStatusHandler } from './routes/status';
import { getAccounts, updateAccountInfo } from './routes/users';
import { ApiKeyDoc } from './db/docs';
import typia from 'typia';

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

export let heartbeatTimer: NodeJS.Timer | undefined;
export const setHeartbeatTimer = (newTimer: NodeJS.Timer | undefined) => {
  heartbeatTimer = newTimer;
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

    let doc = await getFromDB(ApiKeyModel, identifier);
    if (!doc) {
      if (apiKey) {
        throw new Error('Unauthorized request. API key not found.');
      }

      const newDoc: ApiKeyDoc = {
        _docId: identifier,
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

app.set('trust proxy', 1); // trust first proxy
app.use(apiKeyHandler);

// console.log the repsonse
app.use(responseTime({ suffix: false }));

app.use(express.json({ limit: '100mb' }));

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
    store: MongoStore.create({ mongoUrl: process.env.DB_URL }),
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

app.get('/auth/discord', passport.authenticate('discord', { session: false }));
app.get('/auth/discord/callback', discordCallbackHandler);

// Twitter authentication route
app.get('/auth/twitter', async (_req, res) => {
  try {
    const getOAuthRequestToken = () => {
      return new Promise((resolve, reject) => {
        twitterOauth.getOAuthRequestToken((error, oauthToken) => {
          if (error) {
            return reject(error);
          }
          resolve(oauthToken);
        });
      });
    };

    const oauthToken = await getOAuthRequestToken();

    // Redirect the user to Twitter authentication page
    return res.redirect(`https://api.twitter.com/oauth/authenticate?oauth_token=${oauthToken}`);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
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
    await new Promise((resolve, reject) => {
      twitterOauth.get(userProfileUrl, accessToken, accessTokenSecret, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });

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
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
});

app.get('/auth/github', passport.authenticate('github', { session: false }));
app.get('/auth/github/callback', githubCallbackHandler);

app.get('/auth/google', passport.authenticate('google', { session: false, scope: ['profile', 'email'] }));
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
app.post('/api/v0/user/updateAccount', authorizeBlockinRequest([{ scopeName: 'Profile' }]), upload.single('profilePicImageFile'), updateAccountInfo);

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

// Faucet
app.post('/api/v0/faucet', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), getTokensFromFaucet);

// Address Lists
app.post('/api/v0/addressLists/fetch', getAddressLists);
app.post('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Create Address Lists' }]), createAddressLists);
app.put('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Update Address Lists' }]), updateAddressLists);
app.delete('/api/v0/addressLists', authorizeBlockinRequest([{ scopeName: 'Delete Address Lists' }]), deleteAddressLists);

// Blockin Siwbb Requests
app.post('/api/v0/siwbbRequest/fetch', getAndVerifySIWBBRequest);
app.post('/api/v0/siwbbRequest', createSIWBBRequest); // we now verify signature with submitted (message, signature) pair (thus replacing the authorizeBlockinRequest([{ scopeName: 'Full Access']))
app.delete('/api/v0/siwbbRequest', authorizeBlockinRequest([{ scopeName: 'Delete Siwbb Requests' }]), deleteSIWBBRequest);

// Claim Alerts
app.post('/api/v0/claimAlerts/send', sendClaimAlert);
app.post('/api/v0/claimAlerts', authorizeBlockinRequest([{ scopeName: 'Read Claim Alerts' }]), getClaimAlertsForCollection);

// Follow Protocol
app.post('/api/v0/follow-protocol', getFollowDetails);

// Eth First Tx
app.post('/api/v0/ethFirstTx/:cosmosAddress', getBalancesForEthFirstTx);

// Maps
app.post('/api/v0/maps', getMaps);

app.post('/api/v0/siwbbRequest/appleWalletPass', authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createPass);

// Off-Chain Attestation Sigs
app.post('/api/v0/attestation/fetch', getAttestation);
app.post('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Create Attestations' }]), createAttestation);
app.delete('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Delete Attestations' }]), deleteAttestation);
app.put('/api/v0/attestation', authorizeBlockinRequest([{ scopeName: 'Update Attestations' }]), updateAttestation);

// Auth Apps
app.post('/api/v0/developerApp/fetch', websiteOnlyCors, getDeveloperApps);
app.post('/api/v0/developerApp', websiteOnlyCors, authorizeBlockinRequest([{ scopeName: 'Full Access' }]), createDeveloperApp);
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

app.post(
  '/api/v0/oauth/authorize',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  async (req: AuthenticatedRequest<NumberType>, res: Response) => {
    try {
      const {
        response_type,
        client_id,
        redirect_uri,
        scopes
        // state
      } = req.body as OauthAuthorizePayload;
      const validateRes: typia.IValidation<OauthAuthorizePayload> = typia.validate<OauthAuthorizePayload>(req.body);
      if (!validateRes.success) {
        return typiaError(res, validateRes);
      }

      const developerAppDoc = await mustGetFromDB(DeveloperAppModel, client_id);
      if (developerAppDoc.redirectUris.indexOf(redirect_uri) === -1) {
        throw new Error('Invalid redirect URI');
      }

      if (scopes.find((scope) => scope.scopeName === 'Full Access')) {
        throw new Error('Full Access scope is not allowed for API Authorization.');
      }

      if (response_type === 'code') {
        const authDetails = await mustGetAuthDetails(req, res);
        const code: iAuthorizationCodeDoc = {
          _docId: crypto.randomBytes(32).toString('hex'),
          clientId: client_id,
          redirectUri: redirect_uri,
          scopes: scopes,
          address: authDetails.address,
          cosmosAddress: authDetails.cosmosAddress,
          expiresAt: Date.now() + 1000 * 60 * 2
        };
        await insertToDB(AuthorizationCodeModel, code);
        return res.json({ code: code._docId });
      } else {
        throw new Error('Invalid response type. Only "code" is supported.');
      }
    } catch (e) {
      console.error(e);
      return res.status(500).send({
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        errorMessage: e.message
      });
    }
  }
);

app.post('/api/v0/oauth/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, client_id, client_secret, code, redirect_uri, refresh_token } = req.body;
    const validateRes: typia.IValidation<OauthTokenPayload> = typia.validate<OauthTokenPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const client = await mustGetFromDB(DeveloperAppModel, client_id);
    if (!client) {
      return res.status(400).json({ error: 'Invalid client credentials' });
    }

    if (client.clientSecret !== client_secret || client.clientId !== client_id) {
      return res.status(400).json({ error: 'Invalid client credentials' });
    }

    if (grant_type === 'authorization_code') {
      const authorizationCodeDoc = await mustGetFromDB(AuthorizationCodeModel, code);

      if (redirect_uri !== authorizationCodeDoc.redirectUri) {
        return res.status(400).json({ error: 'Invalid redirect URI' });
      }

      if (authorizationCodeDoc.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Authorization code has expired' });
      }

      const accessToken = crypto.randomBytes(32).toString('hex');
      const token: iAccessTokenDoc = {
        _docId: accessToken,
        accessToken: accessToken,
        tokenType: 'bearer',
        accessTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24,
        refreshToken: crypto.randomBytes(32).toString('hex'),
        refreshTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,

        cosmosAddress: mustConvertToCosmosAddress(authorizationCodeDoc.address),
        address: authorizationCodeDoc.address,
        clientId: authorizationCodeDoc.clientId,
        scopes: authorizationCodeDoc.scopes
      };

      await insertToDB(AccessTokenModel, token);
      await deleteMany(AuthorizationCodeModel, [code]);

      return res.json(token);
    } else if (grant_type === 'refresh_token') {
      if (!validator.isHexadecimal(refresh_token)) {
        return res.status(400).json({ error: 'Invalid refresh token' });
      }

      const refreshTokenRes = await findInDB(AccessTokenModel, { query: { refreshToken: { $eq: refresh_token } } });
      if (refreshTokenRes.length === 0) {
        return res.status(400).json({ error: 'Invalid refresh token' });
      }

      const refreshTokenDoc = refreshTokenRes[0];

      if (refreshTokenDoc.refreshTokenExpiresAt < Date.now()) {
        return res.status(400).json({ error: 'Token has expired' });
      }

      const newAccessToken = crypto.randomBytes(32).toString('hex');
      const newToken: iAccessTokenDoc = {
        _docId: newAccessToken,
        accessToken: newAccessToken,
        tokenType: 'bearer',
        accessTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24,
        refreshTokenExpiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
        refreshToken: crypto.randomBytes(32).toString('hex'),
        cosmosAddress: refreshTokenDoc.cosmosAddress,
        address: refreshTokenDoc.address,
        scopes: refreshTokenDoc.scopes,
        clientId: refreshTokenDoc.clientId
      };
      await insertToDB(AccessTokenModel, newToken);
      await deleteMany(AccessTokenModel, [refreshTokenDoc._docId]);

      return res.json(newToken);
    }

    return res.status(400).json({ error: 'Unsupported grant type' });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
});

app.post('/api/v0/oauth/token/revoke', async (req: AuthenticatedRequest<NumberType>, res: Response) => {
  try {
    const { token } = req.body;
    typia.assert<string>(token);

    const accessTokenDoc = await mustGetFromDB(AccessTokenModel, token);
    await deleteMany(AccessTokenModel, [accessTokenDoc._docId]);
    return res.status(200).send({ message: 'Token revoked' });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
});

app.post(
  '/api/v0/oauth/authorizations',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  async (req: AuthenticatedRequest<NumberType>, res: Response) => {
    try {
      const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;
      const docs = await findInDB(AccessTokenModel, { query: { cosmosAddress } });
      const clientIds = docs.map((doc) => doc.clientId);
      const developerApps = await mustGetManyFromDB(DeveloperAppModel, clientIds);

      return res.status(200).json({
        authorizations: docs,
        developerApps: developerApps.map((x) => {
          return { ...x, clientSecret: undefined };
        })
      });
    } catch (e) {
      return res.status(500).send({
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        errorMessage: e.message
      });
    }
  }
);

app.post(
  '/api/v0/apiKeys',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  async (req: AuthenticatedRequest<NumberType>, res: Response) => {
    try {
      typia.assert<string>(req.body.label);
      typia.assert<string>(req.body.intendedUse);

      const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;
      const currApiKeys = await findInDB(ApiKeyModel, { query: { cosmosAddress }, limit: 50 });

      if (currApiKeys.filter((key) => key.expiry > Date.now()).length > 5) {
        return res.status(400).send({
          error: 'Too many active API keys',
          errorMessage: 'You have too many active API keys. Current limit is 5 per user.'
        });
      }

      const newKey = crypto.randomBytes(64).toString('hex');
      await insertToDB(ApiKeyModel, {
        cosmosAddress,
        label: req.body.label ?? '',
        intendedUse: req.body.intendedUse ?? '',
        _docId: newKey,
        numRequests: 0,
        lastRequest: 0,
        createdAt: Date.now(),
        expiry: Date.now() + 1000 * 60 * 60 * 24 * 365,
        tier: 'standard'
      });
      return res.status(200).send({ key: newKey });
    } catch (e) {
      return res.status(500).send({
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        errorMessage: e.message
      });
    }
  }
);

app.delete(
  '/api/v0/apiKeys',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  async (req: AuthenticatedRequest<NumberType>, res: Response) => {
    try {
      const keyToDelete = req.body.key;
      typia.assert<string>(keyToDelete);

      const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;

      const doc = await mustGetFromDB(ApiKeyModel, keyToDelete);
      if (doc.cosmosAddress !== cosmosAddress) {
        return res.status(401).send({
          error: 'Unauthorized',
          errorMessage: 'You are not authorized to delete this key.'
        });
      }

      await deleteMany(ApiKeyModel, [keyToDelete]);

      return res.status(200).send({ message: 'Successfully deleted key' });
    } catch (e) {
      return res.status(500).send({
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        errorMessage: e.message
      });
    }
  }
);

app.post(
  '/api/v0/apiKeys/fetch',
  websiteOnlyCors,
  authorizeBlockinRequest([{ scopeName: 'Full Access' }]),
  async (req: AuthenticatedRequest<NumberType>, res: Response) => {
    try {
      const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;
      const docs = await findInDB(ApiKeyModel, { query: { cosmosAddress }, limit: 100 });
      return res.status(200).json({ docs });
    } catch (e) {
      return res.status(500).send({
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        errorMessage: e.message
      });
    }
  }
);

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

  if (!SHUTDOWN) {
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

export const gracefullyShutdown = async () => {
  SHUTDOWN = true;
  server?.close(() => {
    console.log('server closed');
  });

  console.log('clearing timer');
  clearTimeout(timer);

  console.log('clearing uriPollerTimer');
  clearTimeout(uriPollerTimer);

  console.log('clearing heartbeatTimer');
  clearTimeout(heartbeatTimer);

  console.log('clearing notificationPollerTimer');
  clearTimeout(notificationPollerTimer);

  await mongoose.connection.close();
  console.log('mongoose connection closed');
};

process.on('SIGINT', gracefullyShutdown);
process.on('SIGTERM', gracefullyShutdown);

export default app;
