import sgMail from '@sendgrid/mail';
import { NotificationPreferences } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import Joi from 'joi';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import { insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { OneTimeEmailModel, ProfileModel } from '../db/schemas';
import { SaveForLaterValueHTML, VerificationEmailHTML } from './users';

export const unsubscribeHandler = async (req: Request, res: Response) => {
  try {
    typia.assert<string>(req.params.token);

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

export const oneTimeSendEmailHandler = async (req: Request, res: Response) => {
  try {
    typia.assert<string>(req.body.email);
    Joi.assert(req.body.email, Joi.string().email());

    const id = crypto.randomBytes(16).toString('hex');
    const doc = {
      _docId: id,
      email: req.body.email,
      timestamp: Date.now()
    };

    await OneTimeEmailModel.create(doc);

    const token = id;
    const emails: Array<{
      to: string;
      from: string;
      subject: string;
      html: string;
    }> = [
      {
        to: req.body.email,
        from: 'info@mail.bitbadges.io',
        subject: 'Verify your email',
        html: VerificationEmailHTML(token, '', true)
      }
    ];

    sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
    await sgMail.send(emails, true);

    return res.status(200).send({
      success: true,
      token: doc._docId
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
};

export const verifyOneTimeEmail = async (token: string) => {
  typia.assert<string>(token);

  const docs = await OneTimeEmailModel.find({ _docId: token }).lean().exec();
  const doc = docs.length > 0 ? docs[0] : undefined;
  if (!doc) {
    throw new Error('Token not found');
  }

  if (!doc.timestamp || doc.timestamp + 1000 * 60 * 60 * 24 < Date.now()) {
    throw new Error('Token expired');
  }

  if (!doc.email) {
    throw new Error('Email not found');
  }

  return doc.email;
};

export const oneTimeVerifyEmailHandler = async (req: Request, res: Response) => {
  try {
    const email = await verifyOneTimeEmail(req.body.token);
    return res.status(200).send({
      success: true,
      email: email
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
    typia.assert<string>(req.params.token);

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
          verifiedAt: Date.now(),
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

export const sendSaveForLaterValue = async (req: Request, res: Response) => {
  try {
    typia.assert<string>(req.body.email);
    typia.assert<string>(req.body.subject);
    typia.assert<string>(req.body.body);
    Joi.assert(req.body.email, Joi.string().email());

    const emails: Array<{
      to: string;
      from: string;
      subject: string;
      html: string;
    }> = [
      {
        to: req.body.email,
        from: 'info@mail.bitbadges.io',
        subject: req.body.subject,
        html: SaveForLaterValueHTML(req.body.body)
      }
    ];

    sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
    await sgMail.send(emails, true);

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
};
