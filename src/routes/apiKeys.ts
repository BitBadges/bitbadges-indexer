import { NumberType } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { Response } from 'express';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import { AuthenticatedRequest, mustGetAuthDetails } from '../blockin/blockin_handlers';
import { deleteMany, insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ApiKeyModel } from '../db/schemas';

export async function getApiKeys(req: AuthenticatedRequest<NumberType>, res: Response) {
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


export async function rotateApiKey(req: AuthenticatedRequest<NumberType>, res: Response) {
  try {
    const docId = req.body.docId;
    typia.assert<string>(docId);

    const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;

    const docs = await findInDB(ApiKeyModel, { query: { _docId: docId }, limit: 1 });
    if (docs.length === 0) {
      return res.status(404).send({
        error: 'Not found',
        errorMessage: 'API key not found.'
      });
    }

    const doc = docs[0];
    if (doc.cosmosAddress !== cosmosAddress) {
      return res.status(401).send({
        error: 'Unauthorized',
        errorMessage: 'You are not authorized to delete this key.'
      });
    }

    const newKey = crypto.randomBytes(64).toString('hex');
    const newKeyHash = crypto.createHash('sha256').update(newKey).digest('hex');
    await insertToDB(ApiKeyModel, {
      ...doc,
      apiKey: newKeyHash
    });

    return res.status(200).send({ key: newKey });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
}

export async function deleteApiKey(req: AuthenticatedRequest<NumberType>, res: Response) {
  try {
    const keyToDelete = req.body.key;
    typia.assert<string>(keyToDelete);

    const cosmosAddress = (await mustGetAuthDetails(req, res)).cosmosAddress;

    const docs = await findInDB(ApiKeyModel, { query: { apiKey: keyToDelete }, limit: 1 });
    if (docs.length === 0) {
      return res.status(404).send({
        error: 'Not found',
        errorMessage: 'API key not found.'
      });
    }

    const doc = docs[0];
    if (doc.cosmosAddress !== cosmosAddress) {
      return res.status(401).send({
        error: 'Unauthorized',
        errorMessage: 'You are not authorized to delete this key.'
      });
    }

    await deleteMany(ApiKeyModel, [doc._docId]);

    return res.status(200).send({ message: 'Successfully deleted key' });
  } catch (e) {
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message
    });
  }
}

export async function createApiKey(req: AuthenticatedRequest<NumberType>, res: Response) {
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

    const newDocId = crypto.randomBytes(32).toString('hex');
    const newKey = crypto.randomBytes(64).toString('hex');
    const newKeyHash = crypto.createHash('sha256').update(newKey).digest('hex');
    await insertToDB(ApiKeyModel, {
      cosmosAddress,
      label: req.body.label ?? '',
      apiKey: newKeyHash,
      intendedUse: req.body.intendedUse ?? '',
      _docId: newDocId,
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
