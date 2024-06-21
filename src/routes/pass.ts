import { GenerateAppleWalletPassPayload, NumberType } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import typia from 'typia';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from '../blockin/blockin_handlers';
import { mustGetFromDB } from '../db/db';
import { DeveloperAppModel, SIWBBRequestModel } from '../db/schemas';
import { typiaError } from './search';
// For running tests (TS bugs out)
// import { PKPass } from 'passkit-generator';

// For running
import passkit from 'passkit-generator';
const { PKPass } = passkit;

//Google
const certFileLocation = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '';
const credentials = JSON.parse(fs.readFileSync(certFileLocation).toString());

//Apple
const certDirectory = path.resolve(process.cwd(), 'cert');
const wwdr = fs.readFileSync(path.join(certDirectory, 'wwdr.pem'));
const signerCert = fs.readFileSync(path.join(certDirectory, 'signerCert.pem'));
const signerKey = fs.readFileSync(path.join(certDirectory, 'signerKey.key'));

export const createGooglePass = async (req: AuthenticatedRequest<NumberType>, res: Response<any>) => {
  try {
    const { code } = req.body as unknown as GenerateAppleWalletPassPayload;
    const validateRes: typia.IValidation<GenerateAppleWalletPassPayload> = typia.validate<GenerateAppleWalletPassPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const siwbbRequestDoc = await mustGetFromDB(SIWBBRequestModel, codeHash);
    // const authDetails = await mustGetAuthDetails(req, res);
    // if (convertToCosmosAddress(siwbbRequestDoc.address) !== authDetails.cosmosAddress) {
    //   return res.status(401).send({ errorMessage: 'Unauthorized' });
    // }

    const issuerId = '3388000000022342176';
    const classId = 'BitBadgesPass';

    const clientDoc = await mustGetFromDB(DeveloperAppModel, siwbbRequestDoc.clientId);
    const name = siwbbRequestDoc.name || clientDoc.name;
    // const description = siwbbRequestDoc.description || clientDoc.description;

    const objectId = `${issuerId}.${uuidv4()}`;

    const passData = {
      id: objectId,
      classId: `${issuerId}.${classId}`,
      state: 'active',
      barcode: {
        type: 'qrCode',
        value: code,
        alternateText: 'QR Code'
      },
      logo: {
        sourceUri: {
          uri: 'https://avatars.githubusercontent.com/u/86890740'
        },
        contentDescription: {
          defaultValue: {
            language: 'en-US',
            value: 'BitBadges Logo'
          }
        }
      },
      cardTitle: {
        defaultValue: {
          language: 'en',
          value: 'BitBadges Pass'
        }
      },
      header: {
        defaultValue: {
          language: 'en',
          value: name
        }
      },
      hexBackgroundColor: '#001529'
    };

    const claims = {
      iss: credentials.client_email,
      aud: 'google',
      origins: [],
      typ: 'savetowallet',
      payload: {
        genericObjects: [passData]
      }
    };
    const token = jwt.sign(claims, credentials.private_key, { algorithm: 'RS256' });
    const saveUrl = `https://pay.google.com/gp/v/save/${token}`;

    return res.send({ saveUrl });
  } catch (e) {
    console.log(e);
    console.error(e);
    return res.status(500).send({ errorMessage: e.message });
  }
};

export const createPass = async (req: AuthenticatedRequest<NumberType>, res: Response<any>) => {
  try {
    const { code } = req.body as unknown as GenerateAppleWalletPassPayload;
    const validateRes: typia.IValidation<GenerateAppleWalletPassPayload> = typia.validate<GenerateAppleWalletPassPayload>(req.body);
    if (!validateRes.success) {
      return typiaError(res, validateRes);
    }

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const siwbbRequestDoc = await mustGetFromDB(SIWBBRequestModel, codeHash);
    // const authDetails = await mustGetAuthDetails(req, res);
    // if (convertToCosmosAddress(siwbbRequestDoc.address) !== authDetails.cosmosAddress) {
    //   return res.status(401).send({ errorMessage: 'Unauthorized' });
    // }

    const clientDoc = await mustGetFromDB(DeveloperAppModel, siwbbRequestDoc.clientId);
    const name = siwbbRequestDoc.name || clientDoc.name;
    const description = siwbbRequestDoc.description || clientDoc.description;
    const passID = code;
    const pass = await PKPass.from(
      {
        model: path.resolve(process.cwd(), 'ticket.pass'),
        certificates: {
          wwdr,
          signerCert,
          signerKey
        }
      },
      {
        serialNumber: passID,
        description: description || ' ',
        organizationName: 'BitBadges',
        backgroundColor: 'rgb(255, 255, 255)',
        foregroundColor: 'rgb(0, 0, 0)'
      }
    );
    // Adding some settings to be written inside pass.json
    pass.setBarcodes(passID);
    if (name) {
      pass.secondaryFields.push({
        key: 'guest',
        label: 'Name',
        value: name
      });
    }
    if (description) {
      pass.auxiliaryFields.push({
        key: 'description',
        label: 'Description',
        value: description || ' '
      });
    }
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    return res.status(200).send(JSON.stringify(pass.getAsBuffer()));
  } catch (e) {
    console.error(e);
    return res.status(500).send({ errorMessage: e.message });
  }
};
