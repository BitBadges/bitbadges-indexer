import { NotificationPreferences } from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ProfileModel } from '../db/schemas';

export const unsubscribeHandler = async (req: Request, res: Response) => {
  try {
    const docs = await findInDB(ProfileModel, {
      query: { 'notifications.emailVerification.token': { $eq: req.params.token } }
    });
    const doc = docs.length > 0 ? docs[0] : undefined;
    if (doc) {
      const newDoc = {
        ...doc,
        notifications: new NotificationPreferences({
          email: '',
          preferences: undefined,
          emailVerification: {
            token: undefined,
            verified: false,
            expiry: undefined
          },
          discord: doc.notifications?.discord
        })
      };

      await insertToDB(ProfileModel, newDoc);
    }

    const discordDocs = await findInDB(ProfileModel, {
      query: { 'notifications.discord.token': { $eq: req.params.token } }
    });
    const discordDoc = discordDocs.length > 0 ? discordDocs[0] : undefined;
    if (discordDoc) {
      const newDiscordDoc = {
        ...discordDoc,
        notifications: new NotificationPreferences({
          email: discordDoc.notifications?.email,
          preferences: discordDoc.notifications?.preferences,
          emailVerification: discordDoc.notifications?.emailVerification,
          discord: undefined
        })
      };

      await insertToDB(ProfileModel, newDiscordDoc);
    }

    return res.status(200).send({
      success: true
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
};

export const verifyEmailHandler = async (req: Request, res: Response) => {
  try {
    const docs = await findInDB(ProfileModel, {
      query: { 'notifications.emailVerification.token': { $eq: req.params.token } }
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
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
};
