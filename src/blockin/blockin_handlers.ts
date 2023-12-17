import { BigIntify } from 'bitbadgesjs-proto';
import { CheckSignInStatusResponse, ErrorResponse, GetSignInChallengeRouteRequestBody, GetSignInChallengeRouteResponse, NumberType, Numberify, SignOutResponse, SupportedChain, VerifySignInRouteRequestBody, VerifySignInRouteResponse, convertCollectionDoc, convertIPFSTotalsDoc, convertToCosmosAddress, getChainForAddress, getCurrentValueForTimeline } from 'bitbadgesjs-utils';
import { ChallengeParams, constructChallengeObjectFromString, createChallenge, setChainDriver, verifyChallenge } from 'blockin';
import { NextFunction, Request, Response } from 'express';
import { Session } from 'express-session';
import { serializeError } from 'serialize-error';
import { generateNonce } from 'siwe';
import { CollectionModel, IPFSTotalsModel, ProfileModel, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { getChainDriver } from './blockin';

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
  // console.log(req.session);
  return req.session.blockin && req.session.nonce && req.session.blockinParams && req.session.cosmosAddress && req.session.address && req.session.blockinParams.address === req.session.address;
}


export async function checkIfManager(req: AuthenticatedRequest<NumberType>, collectionId: NumberType) {
  if (!checkIfAuthenticated(req)) return false;
  //Should we account for if the indexer is out of sync / catching up and managerTimeline is potentially different now?

  const collectionIdStr = BigInt(collectionId).toString();
  const _collection = await mustGetFromDB(CollectionModel, collectionIdStr);
  const collection = convertCollectionDoc(_collection, BigIntify);

  const manager = getCurrentValueForTimeline(collection.managerTimeline)?.manager;
  if (manager && req.session.cosmosAddress && manager !== req.session.cosmosAddress) {
    return false;
  }

  return true;
}

export async function returnUnauthorized(res: Response<ErrorResponse>, managerRoute: boolean = false) {
  return res.status(401).json({ message: `Unauthorized. You must be signed in ${managerRoute ? 'and the manager of the collection' : ''}.`, unauthorized: true });
}

const statement = `Sign this message only if prompted by a trusted party. The signature of this message can be used to authenticate you on BitBadges. By signing, you agree to the BitBadges privacy policy and terms of service.`;
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
      req.session.save();
    }

    const hours = reqBody.hours ? Math.floor(Number(reqBody.hours)) : 168 * 2;
    if (isNaN(hours)) {
      return res.status(400).json({ message: 'Invalid hours' });
    }

    // Get the current time
    const now = new Date();
    const twoWeeks = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const iso8601 = twoWeeks.toISOString();

    const challengeParams = {
      domain: 'https://bitbadges.io',
      statement: statement,
      address: reqBody.address,
      uri: 'https://bitbadges.io',
      nonce: req.session.nonce,

      //Note these really do not matter since they can be selected on the frontend.
      expirationDate: iso8601,
      notBefore: undefined,
      resources: [],
      assets: [],
    }

    const blockinMessage = await createChallenge(challengeParams, reqBody.chain);

    return res.status(200).json({
      nonce: req.session.nonce,
      params: challengeParams,
      blockinMessage: blockinMessage
    });
  } catch (err) {
    console.error(err);
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

  const body = req.body as VerifySignInRouteRequestBody;

  const chainDriver = getChainDriver(body.chain);
  setChainDriver(chainDriver);

  try {
    const generatedEIP4361ChallengeStr: string = body.message;

    const challenge: ChallengeParams<NumberType> = constructChallengeObjectFromString(generatedEIP4361ChallengeStr, BigIntify);
    const verificationResponse = await verifyChallenge(
      body.message,
      body.signature,
      body.options ?? {
        expectedChallengeParams: {
          domain: 'https://bitbadges.io',
          uri: 'https://bitbadges.io',
          statement: statement,
        },
        beforeVerification: async (challengeParams) => {
          if (!req.session.nonce) {
            return Promise.reject(new Error('No nonce found in session. Please try again.'));
          }

          if (challengeParams.nonce !== req.session.nonce) {
            return Promise.reject(new Error(`Invalid nonce.Expected ${req.session.nonce}, got ${challengeParams.nonce}`));
          }
        }
      }
    );

    req.session.address = challenge.address;
    req.session.cosmosAddress = convertToCosmosAddress(challenge.address);
    req.session.blockinParams = challenge;
    req.session.blockin = generatedEIP4361ChallengeStr;
    if (challenge.expirationDate) {
      req.session.cookie.expires = new Date(challenge.expirationDate);
    }

    const [ipfsDoc, profileDoc] = await Promise.all([
      getFromDB(IPFSTotalsModel, req.session.cosmosAddress),
      getFromDB(ProfileModel, req.session.cosmosAddress),
    ]);

    const ipfsTotals = ipfsDoc ? convertIPFSTotalsDoc(ipfsDoc, Numberify) : null;
    req.session.ipfsTotal = ipfsTotals ? ipfsTotals.bytesUploaded : 0;


    if (!profileDoc || (profileDoc && profileDoc.latestSignedInChain !== body.chain)) {
      await insertToDB(ProfileModel, {
        ...profileDoc,
        _legacyId: req.session.cosmosAddress,
        latestSignedInChain: body.chain,
        solAddress: getChainForAddress(challenge.address) == SupportedChain.SOLANA ? challenge.address : profileDoc?.solAddress,
      });
    }

    req.session.save();

    return res.status(200).json({ success: true, successMessage: verificationResponse.message });
  } catch (err) {
    console.log(err);

    return res.status(401).json({ success: false, message: `${err.message} ` });
  }
}


export async function authorizeBlockinRequest(expressReq: Request, res: Response<ErrorResponse>, next: NextFunction) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  if (!checkIfAuthenticated(req)) return returnUnauthorized(res);
  return next();
}

export async function genericBlockinVerify(params: VerifySignInRouteRequestBody) {
  try {
    const body = params;
    if (body.options?.beforeVerification) {
      throw `You cannot use the beforeVerification option with this endpoint.Please run this verification logic yourself.`;
    }

    const chainDriver = getChainDriver(body.chain);
    setChainDriver(chainDriver);

    const verificationResponse = await verifyChallenge(
      body.message,
      body.signature,
      {
        ...body.options,
        beforeVerification: undefined,
      }
    );

    return verificationResponse;
  } catch (err) {
    throw new Error(err);
  }
}

export async function genericBlockinVerifyHandler(expressReq: Request, res: Response<VerifySignInRouteResponse<NumberType>>) {
  const req = expressReq as AuthenticatedRequest<NumberType>;

  const body = req.body as VerifySignInRouteRequestBody;

  try {
    const verificationResponse = await genericBlockinVerify(body);

    return res.status(200).json({ success: true, successMessage: verificationResponse.message });
  } catch (err) {
    console.log(err);

    return res.status(401).json({ success: false, message: `${err.message} ` });
  }
}