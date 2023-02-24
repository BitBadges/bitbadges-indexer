import { ChallengeParams, constructChallengeObjectFromString, setChainDriver, verifyChallenge, createChallenge } from 'blockin';
import { NextFunction, Request, Response } from 'express';
import { Session } from 'express-session';
import { generateNonce } from 'siwe';
import { getChainDriver } from '../blockin/blockin';
import { parse } from '../util/preserveJson';

export interface BlockinSession extends Session {
    nonce: string | null;
    blockin: string | null;
    blockinParams: ChallengeParams | null;
}

export interface AuthenticatedRequest extends Request {
    session: BlockinSession;
}

export async function getChallenge(expressReq: Request, res: Response) {
    const req = expressReq as AuthenticatedRequest;

    const chainDriver = getChainDriver(req.body.chain);
    setChainDriver(chainDriver);

    req.session.nonce = generateNonce();
    req.session.save();

    // Get the current time
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const iso8601 = tomorrow.toISOString();


    const challengeParams = {
        domain: 'https://blockin.com',
        statement: 'BitBadges uses Blockin to authenticate users. Please sign this message to continue. You will stay signed in for 24 hours.',
        address: req.body.address,
        uri: 'https://blockin.com/login',
        nonce: req.session.nonce,
        expirationDate: iso8601,
        notBefore: undefined,
        resources: []
    }

    const blockinMessage = await createChallenge(challengeParams, req.body.chain);

    console.log(req.session);


    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).json({
        nonce: req.session.nonce,
        params: challengeParams,
        blockinMessage: blockinMessage
    });
}

export async function removeBlockinSessionCookie(expressReq: Request, res: Response, next: NextFunction) {
    const req = expressReq as AuthenticatedRequest;

    req.session.blockin = null;
    req.session.nonce = null;

    return res.status(200).send({ message: 'Successfully removed session cookie!' });
}

export async function verifyBlockinAndGrantSessionCookie(expressReq: Request, res: Response, next: NextFunction) {
    const req = expressReq as AuthenticatedRequest;

    const body = parse(JSON.stringify(req.body)); //little hack to preserve Uint8Arrays

    const chainDriver = getChainDriver(body.chain);
    setChainDriver(chainDriver);

    async function getChallengeStringFromBytes(txnBytes: Uint8Array): Promise<string> {
        return chainDriver.parseChallengeStringFromBytesToSign(txnBytes);
    }

    console.log("VERIFY", req.session);

    try {
        const generatedEIP4361ChallengeStr: string = await getChallengeStringFromBytes(body.originalBytes);
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

        req.session.blockinParams = challenge;
        req.session.blockin = generatedEIP4361ChallengeStr;
        if (challenge.expirationDate) {
            req.session.cookie.expires = new Date(challenge.expirationDate);
            console.log("Expires at: ", req.session.cookie.expires);
        }
        req.session.save();

        return res.status(200).json({ verified: true, message: verificationResponse.message });
    } catch (err) {
        req.session.blockin = null;
        req.session.nonce = null;
        return res.status(401).json({ verified: false, message: `${err}` });
    }
}

export async function authorizeRequest(expressReq: Request, res: Response, next: NextFunction) {
    const req = expressReq as AuthenticatedRequest;

    try {
        if (!req.session.blockin) {
            throw 'User is not signed in w/ Blockin';
        }

        console.log('User is authenticated!', req.session.blockin);
    } catch (error) {
        return res.status(401).json({ message: error });
    }

    expressReq = req;

    return next();
}
