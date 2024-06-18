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
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/google/callback' : 'https://api.bitbadges.io/auth/google/callback'
    },
    function (accessToken, refreshToken, profile, cb) {
      const user = {
        id: profile.id,
        username: profile.emails ? profile.emails[0].value : '',
        access_token: accessToken
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
      callbackURL: process.env.DEV_MODE === 'true' ? 'http://localhost:3001/auth/github/callback' : 'https://api.bitbadges.io/auth/github/callback'
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
