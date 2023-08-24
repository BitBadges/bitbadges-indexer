import { BigIntify } from 'bitbadgesjs-proto';
import { CheckSignInStatusResponse, convertCollectionDoc, convertIPFSTotalsDoc, convertToCosmosAddress, ErrorResponse, getCurrentValueIdxForTimeline, GetSignInChallengeRouteRequestBody, GetSignInChallengeRouteResponse, Numberify, NumberType, SignOutResponse, VerifySignInRouteRequestBody, VerifySignInRouteResponse } from 'bitbadgesjs-utils';
import { ChallengeParams, constructChallengeObjectFromString, createChallenge, setChainDriver, verifyChallenge } from 'blockin';
import { NextFunction, Request, Response } from 'express';
import { Session } from 'express-session';
import { serializeError } from 'serialize-error';
import { generateNonce } from 'siwe';
import { COLLECTIONS_DB, insertToDB, IPFS_TOTALS_DB, PROFILES_DB } from '../db/db';
import { parse } from '../utils/preserveJson';
import { getChainDriver } from './blockin';
import { catch404 } from '../utils/couchdb-utils';

export interface BlockinSession<T extends NumberType> extends Session {
  nonce: string | null;
  blockin: string | null;
  blockinParams: ChallengeParams<T> | null;
  cosmosAddress: string | null;
  address: string | null;
  ipfsTotal: number | null;
}

export interface BlockinSessionAuthenticated<T extends NumberType> extends BlockinSession<T> {
  nonce: string;
  blockin: string;
  blockinParams: ChallengeParams<T>;
  cosmosAddress: string;
  address: string;
  ipfsTotal: number;
}

export interface AuthenticatedRequest<T extends NumberType> extends Request {
  session: BlockinSessionAuthenticated<T>;
}

export function checkIfAuthenticated(req: AuthenticatedRequest<NumberType>) {
  return req.session.blockin && req.session.nonce && req.session.blockinParams && req.session.cosmosAddress && req.session.address;
}


export async function checkIfManager(req: AuthenticatedRequest<NumberType>, collectionId: NumberType) {
  if (!checkIfAuthenticated(req)) return false;

  const collectionIdStr = BigInt(collectionId).toString();
  const _collection = await COLLECTIONS_DB.get(`${collectionIdStr}`);
  const collection = convertCollectionDoc(_collection, BigIntify);

  const managerIdx = getCurrentValueIdxForTimeline(collection.managerTimeline);
  if (managerIdx == -1n) {
    return false;
  }

  const manager = collection.managerTimeline[Number(managerIdx)].manager;
  if (req.session.cosmosAddress && manager !== req.session.cosmosAddress) {
    return false;
  }

  return true;
}

export async function returnUnauthorized(res: Response<ErrorResponse>, managerRoute: boolean = false) {
  return res.status(401).json({ message: `Unauthorized. You must be signed in ${managerRoute ? 'and the manager of the collection' : ''}.`, unauthorized: true });
}

export async function getChallenge(expressReq: Request, res: Response<GetSignInChallengeRouteResponse<NumberType>>) {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetSignInChallengeRouteRequestBody;

    const chainDriver = getChainDriver(reqBody.chain);
    setChainDriver(chainDriver);


    const cosmosAddress = convertToCosmosAddress(reqBody.address);
    if (!cosmosAddress) {
      return res.status(400).json({ message: 'Invalid address' });
    }

    if (cosmosAddress !== req.session.cosmosAddress) {
      req.session.nonce = generateNonce();
      req.session.cosmosAddress = cosmosAddress;
      req.session.address = reqBody.address;
      req.session.save();
      console.log(req.session.nonce);
    }

    const hours = reqBody.hours ? Math.floor(Number(reqBody.hours)) : 24;
    if (isNaN(hours)) {
      return res.status(400).json({ message: 'Invalid hours' });
    }

    // Get the current time
    const now = new Date();
    const tomorrow = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const iso8601 = tomorrow.toISOString();

    const challengeParams = {
      domain: 'https://bitbadges.io',
      statement: `BitBadges uses Blockin to authenticate users. To sign in, please sign this message with your connected wallet.`,
      address: reqBody.address,
      uri: 'https://bitbadges.io',
      nonce: req.session.nonce,
      expirationDate: iso8601,
      notBefore: undefined,
      resources: [],
      assets: [],
    }

    const blockinMessage = await createChallenge(challengeParams, reqBody.chain);
    console.log(blockinMessage);

    return res.status(200).json({
      nonce: req.session.nonce,
      params: challengeParams,
      blockinMessage: blockinMessage
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      error: serializeError(err),
      message: 'Error creating challenge. Please try again later.'
    });
  }
}

export async function checkifSignedInHandler(expressReq: Request, res: Response<CheckSignInStatusResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  if (!checkIfAuthenticated(req)) {
    return res.status(200).send({ signedIn: false });
  }
  return res.status(200).send({ signedIn: true });
}

export async function removeBlockinSessionCookie(expressReq: Request, res: Response<SignOutResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  let session = req.session as BlockinSession<NumberType> | null;
  if (session) {
    session.blockin = null;
    session.nonce = null;
    session.blockinParams = null;
    session.cosmosAddress = null;
    session.address = null;
    session = null;
  } else {
    session = null
  }

  req.session.save();

  return res.status(200).send({ message: 'Successfully removed session cookie!' });
}

export async function verifyBlockinAndGrantSessionCookie(expressReq: Request, res: Response<VerifySignInRouteResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  const body = parse(JSON.stringify(req.body)) as VerifySignInRouteRequestBody;

  const chainDriver = getChainDriver(body.chain);
  setChainDriver(chainDriver);

  try {
    const generatedEIP4361ChallengeStr: string = await chainDriver.parseChallengeStringFromBytesToSign(body.originalBytes);

    const challenge: ChallengeParams<NumberType> = constructChallengeObjectFromString(generatedEIP4361ChallengeStr, BigIntify);
    console.log(challenge);
    const verificationResponse = await verifyChallenge(
      body.originalBytes,
      body.signatureBytes,
      BigIntify,
      {
        expectedChallengeParams: {},
      }
    );

    if (challenge.nonce !== req.session.nonce) {
      console.log(req.session.nonce, "does not equal", challenge.nonce);
      return res.status(422).json({
        message: 'Invalid nonce.',
      });
    }

    // if (req.session.blockin !== generatedEIP4361ChallengeStr) {
    //   console.log(req.session.blockin, "does not equal", generatedEIP4361ChallengeStr);
    //   return res.status(422).json({
    //     message: 'Challenge was not generated by this server.',
    //   });
    // }

    if (convertToCosmosAddress(challenge.address) !== req.session.cosmosAddress) {
      console.log(req.session.cosmosAddress, "does not equal", challenge.address);
      return res.status(422).json({
        message: 'Invalid address.',
      });
    }

    req.session.blockinParams = challenge;
    req.session.blockin = generatedEIP4361ChallengeStr;
    if (challenge.expirationDate) {
      req.session.cookie.expires = new Date(challenge.expirationDate);
    }

    const _doc = await IPFS_TOTALS_DB.get(req.session.cosmosAddress).catch(catch404);
    const doc = _doc ? convertIPFSTotalsDoc(_doc, Numberify) : null;
    req.session.ipfsTotal = doc ? doc.bytesUploaded : 0;

    const profileDoc = await PROFILES_DB.get(req.session.cosmosAddress).catch(catch404);
    await insertToDB(PROFILES_DB, {
      ...profileDoc,
      _id: req.session.cosmosAddress,
      latestSignedInChain: body.chain,
    });

    req.session.save();

    return res.status(200).json({ success: true, successMessage: verificationResponse.message });
  } catch (err) {
    console.log(err);

    let session = req.session as BlockinSession<NumberType> | null;
    if (session) {
      session.blockin = null;
      session.nonce = null;
      session.blockinParams = null;
      session.address = null;
      session.cosmosAddress = null;
      session = null;
    } else {
      session = null
    }
    req.session.save();

    return res.status(401).json({ success: false, message: `${err.message}` });
  }
}

export async function authorizeBlockinRequest(expressReq: Request, res: Response<ErrorResponse>, next: NextFunction) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  if (!checkIfAuthenticated(req)) return returnUnauthorized(res);
  return next();
}