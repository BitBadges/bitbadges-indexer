import { NotificationPreferences } from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ProfileModel } from '../db/schemas';

export const unsubscribeHandler = async (req: Request, res: Response) => {
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
};

export const verifyEmailHandler = async (req: Request, res: Response) => {
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
};
