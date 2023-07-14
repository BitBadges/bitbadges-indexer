import { convertIPFSTotalsDoc, convertToCosmosAddress, ErrorResponse, GetSignInChallengeRouteRequestBody, GetSignInChallengeRouteResponse, Numberify, NumberType, SignOutResponse, VerifySignInRouteRequestBody, VerifySignInRouteResponse } from 'bitbadgesjs-utils';
import { ChallengeParams, constructChallengeObjectFromString, createChallenge, setChainDriver, verifyChallenge } from 'blockin';
import { NextFunction, Request, Response } from 'express';
import { Session } from 'express-session';
import { generateNonce } from 'siwe';
import { parse } from '../utils/preserveJson';
import { getChainDriver } from './blockin';
import { COLLECTIONS_DB, IPFS_TOTALS_DB } from '../db/db';
import { serializeError } from 'serialize-error';

export interface BlockinSession extends Session {
  nonce: string | null;
  blockin: string | null;
  blockinParams: ChallengeParams | null;
  cosmosAddress: string | null;
  address: string | null;
  ipfsTotal: number | null;
}

export interface BlockinSessionAuthenticated extends BlockinSession {
  nonce: string;
  blockin: string;
  blockinParams: ChallengeParams;
  cosmosAddress: string;
  address: string;
  ipfsTotal: number;
}

export interface AuthenticatedRequest extends Request {
  session: BlockinSessionAuthenticated
}

export function checkIfAuthenticated(req: AuthenticatedRequest) {
  return req.session.blockin && req.session.nonce && req.session.blockinParams && req.session.cosmosAddress && req.session.address;
}


export async function checkIfManager(req: AuthenticatedRequest, collectionId: NumberType) {
  if (!checkIfAuthenticated(req)) return false;

  const collectionIdStr = BigInt(collectionId).toString();
  const collection = await COLLECTIONS_DB.get(`${collectionIdStr}`);
  const manager = collection.manager;
  if (req.session.cosmosAddress && manager !== req.session.cosmosAddress) {
    return false;
  }

  return true;
}

export async function returnUnauthorized(res: Response<ErrorResponse>, managerRoute: boolean = false) {
  return res.status(401).json({ message: `Unauthorized. You must be signed in ${managerRoute ? 'and the manager of the collection' : ''} to access this route.`, unauthorized: true });
}

export async function getChallenge(expressReq: Request, res: Response<GetSignInChallengeRouteResponse<NumberType>>) {
  try {
    const req = expressReq as AuthenticatedRequest;
    const reqBody = req.body as GetSignInChallengeRouteRequestBody;

    const chainDriver = getChainDriver(reqBody.chain);
    setChainDriver(chainDriver);

    req.session.nonce = generateNonce();
    const cosmosAddress = convertToCosmosAddress(reqBody.address);
    if (!cosmosAddress) {
      return res.status(400).json({ message: 'Invalid address' });
    }

    req.session.cosmosAddress = cosmosAddress;
    req.session.address = reqBody.address;
    req.session.save();

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
      statement: `BitBadges uses Blockin to authenticate users. To sign in, please sign this message with your connected wallet. You will stay signed in for ${hours} hours.`,
      address: reqBody.address,
      uri: 'https://bitbadges.io',
      nonce: req.session.nonce,
      expirationDate: iso8601,
      notBefore: undefined,
      resources: []
    }

    const blockinMessage = await createChallenge(challengeParams, reqBody.chain);

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

export async function removeBlockinSessionCookie(expressReq: Request, res: Response<SignOutResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest;

  const session = req.session as BlockinSession;
  session.blockin = null;
  session.nonce = null;
  session.blockinParams = null;
  session.cosmosAddress = null;
  session.address = null;

  req.session.save();

  return res.status(200).send({ message: 'Successfully removed session cookie!' });
}

export async function verifyBlockinAndGrantSessionCookie(expressReq: Request, res: Response<VerifySignInRouteResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest;

  const body = parse(JSON.stringify(req.body)) as VerifySignInRouteRequestBody;

  const chainDriver = getChainDriver(body.chain);
  setChainDriver(chainDriver);

  try {
    const generatedEIP4361ChallengeStr: string = await chainDriver.parseChallengeStringFromBytesToSign(body.originalBytes);

    const challenge: ChallengeParams = constructChallengeObjectFromString(generatedEIP4361ChallengeStr);

    const verificationResponse = await verifyChallenge(
      body.originalBytes,
      body.signatureBytes
    );

    if (challenge.nonce !== req.session.nonce) {
      console.log(req.session.nonce, "does not equal", challenge.nonce);
      return res.status(422).json({
        message: 'Invalid nonce.',
      });
    }

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

    const _doc = await IPFS_TOTALS_DB.get(req.session.cosmosAddress)
    const doc = convertIPFSTotalsDoc(_doc, Numberify);
    req.session.ipfsTotal = doc ? doc.kbUploaded : 0;

    req.session.save();

    return res.status(200).json({ success: true, successMessage: verificationResponse.message });
  } catch (err) {
    console.log(err);

    const session = req.session as BlockinSession;
    session.blockin = null;
    session.nonce = null;
    session.blockinParams = null;
    session.address = null;
    session.cosmosAddress = null;
    req.session.save();

    return res.status(401).json({ success: false, message: `${err}` });
  }
}

export async function authorizeBlockinRequest(expressReq: Request, res: Response<ErrorResponse>, next: NextFunction) {
  const req = expressReq as AuthenticatedRequest;
  if (!checkIfAuthenticated(req)) return returnUnauthorized(res);
  return next();
}