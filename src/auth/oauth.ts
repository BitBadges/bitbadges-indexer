import { SocialConnections, SocialConnectionInfo } from 'bitbadgesjs-sdk';
import { NextFunction, type Request, type Response } from 'express';

import OAuthPkg from 'oauth';
import passport from 'passport';
import { type BlockinSession } from '../blockin/blockin_handlers';
import { mustGetFromDB, insertToDB } from '../db/db';
import { ProfileModel } from '../db/schemas';
import passportDiscord from 'passport-discord';
import passportGithub from 'passport-github';
import passportGoogle from 'passport-google-oauth20';
import { serializeError } from 'serialize-error';
import OAuth2Strategy from 'passport-oauth2';
import axios from 'axios';
import querystring from 'querystring';

const OAuth = OAuthPkg.OAuth;

const DiscordStrategy = passportDiscord.Strategy;
const GitHubStrategy = passportGithub.Strategy;
const GoogleStrategy = passportGoogle.Strategy;

const scopes = ['identify', 'guilds', 'guilds.members.read'];

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
passport.use(
  'twitch',
  new OAuth2Strategy(
    {
      authorizationURL: 'https://id.twitch.tv/oauth2/authorize',
      tokenURL: 'https://id.twitch.tv/oauth2/token',
      clientID: TWITCH_CLIENT_ID ?? '',
      clientSecret: TWITCH_CLIENT_SECRET ?? '',
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/twitch/callback' : 'https://api.bitbadges.io/auth/twitch/callback',
      state: true
    },
    function (accessToken: string, refreshToken: string, profile: any, done: any) {
      profile.accessToken = accessToken;
      profile.refreshToken = refreshToken;

      done(null, profile);
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/google/callback' : 'https://api.bitbadges.io/auth/google/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.emails ? profile.emails[0].value : '',
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + 3600000
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
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/discord/callback' : 'https://api.bitbadges.io/auth/discord/callback',
      scope: scopes
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.username,
        discriminator: profile.discriminator,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + 604800
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
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/github/callback' : 'https://api.bitbadges.io/auth/github/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.username,
        access_token: accessToken,
        refresh_token: refreshToken, //Doesn't return refresh token
        expires_at: Number.MAX_SAFE_INTEGER
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

export const twitchCallbackHandler = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('twitch', async function (err: Error, callbackVal: { accessToken: string; refreshToken: string }) {
    try {
      if (err) {
        return next(err);
      }
      if (!callbackVal) {
        return res.status(401).send('Unauthorized. No user found.');
      }

      const { accessToken } = callbackVal;

      const options = {
        url: 'https://api.twitch.tv/helix/users',
        method: 'GET',
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          Accept: 'application/vnd.twitchtv.v5+json',
          Authorization: 'Bearer ' + accessToken
        }
      };

      const resp = await axios.get(options.url, { headers: options.headers });
      const data = resp.data;
      const user = {
        id: data.data[0].id,
        username: data.data[0].login,
        access_token: accessToken,
        refresh_token: callbackVal.refreshToken,
        expires_at: Date.now() + 1000 * 60 * 60 * 24 * 30
      };

      (req.session as BlockinSession<bigint>).twitch = user;
      req.session.save();

      if (req.session && (req.session as BlockinSession<bigint>).cosmosAddress) {
        const profileDoc = await mustGetFromDB(ProfileModel, (req.session as BlockinSession<bigint>).cosmosAddress!);
        profileDoc.socialConnections = new SocialConnections({
          ...profileDoc.socialConnections,
          twitch: new SocialConnectionInfo({
            username: user.username,
            id: user.id,
            lastUpdated: BigInt(Date.now())
          })
        });
        await insertToDB(ProfileModel, profileDoc);
      }

      return res.status(200).redirect('https://bitbadges.io/connections?redirected=true');
    } catch (e) {
      console.error(e);
      return res.status(500).send({
        errorMessage: 'Internal server error',
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined
      });
    }
  })(req, res, next);
};

export const discordCallbackHandler = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('discord', async function (err: Error, user: any) {
    try {
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

      return res.status(200).redirect('https://bitbadges.io/connections?redirected=true');
    } catch (e) {
      console.error(e);
      return res.status(500).send({
        errorMessage: 'Internal server error',
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined
      });
    }
  })(req, res, next);
};

export const twitterConfig = {
  consumerKey: process.env.TWITTER_CONSUMER_KEY || '',
  consumerSecret: process.env.TWITTER_CONSUMER_SECRET || '',
  callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/twitter/callback' : 'https://api.bitbadges.io/auth/twitter/callback'
};

const oauthRequestTokenUrl = 'https://api.twitter.com/oauth/request_token';
export const twitterOauth = new OAuth(
  oauthRequestTokenUrl,
  'https://api.twitter.com/oauth/access_token',
  twitterConfig.consumerKey,
  twitterConfig.consumerSecret,
  '1.0A',
  twitterConfig.callbackURL,
  'HMAC-SHA1'
);

export const githubCallbackHandler = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('github', async function (err: Error, user: any) {
    try {
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

      return res.status(200).redirect('https://bitbadges.io/connections?redirected=true');
    } catch (e) {
      console.error(e);
      return res.status(500).send({
        errorMessage: 'Internal server error',
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined
      });
    }
  })(req, res, next);
};

export const googleCallbackHandler = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('google', async function (err: Error, user: any) {
    try {
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

      return res.status(200).redirect('https://bitbadges.io/connections?redirected=true');
    } catch (e) {
      console.error(e);
      return res.status(500).send({
        errorMessage: 'Internal server error',
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined
      });
    }
  })(req, res, next);
};

export const twitterAuthorizeHandler = async (req: Request, res: Response) => {
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
};

export const twitterCallbackHandler = async (req: Request, res: Response) => {
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
    const profileData = await new Promise((resolve, reject) => {
      twitterOauth.get(userProfileUrl, accessToken, accessTokenSecret, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    });

    const profile = JSON.parse(profileData as any);
    const user = {
      id: profile.id_str,
      username: profile.screen_name,
      access_token: accessToken,
      access_token_secret: accessTokenSecret,
      refresh_token: '',
      expires_at: Number.MAX_SAFE_INTEGER
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

    return res.status(200).redirect('https://bitbadges.io/connections?redirected=true');
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
};
