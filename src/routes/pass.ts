import { GenerateAppleWalletPassPayload, NumberType, convertToCosmosAddress } from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest, mustGetAuthDetails } from '../blockin/blockin_handlers';
import { mustGetFromDB } from '../db/db';
import { SIWBBRequestModel } from '../db/schemas';

// For running tests (TS bugs out)
import { PKPass } from 'passkit-generator';

// For running
// import passkit from 'passkit-generator';
// const { PKPass } = passkit;

const certDirectory = path.resolve(process.cwd(), 'cert');
const wwdr = fs.readFileSync(path.join(certDirectory, 'wwdr.pem'));
const signerCert = fs.readFileSync(path.join(certDirectory, 'signerCert.pem'));
const signerKey = fs.readFileSync(path.join(certDirectory, 'signerKey.key'));

export const createPass = async (req: AuthenticatedRequest<NumberType>, res: Response<any>) => {
  try {
    const { code } = req.body as unknown as GenerateAppleWalletPassPayload;

    const siwbbRequestDoc = await mustGetFromDB(SIWBBRequestModel, code);
    const authDetails = await mustGetAuthDetails(req, res);
    if (convertToCosmosAddress(siwbbRequestDoc.params.address) !== authDetails.cosmosAddress) {
      return res.status(401).send({ errorMessage: 'Unauthorized' });
    }

    const { params, name, description } = siwbbRequestDoc;
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
        description,
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
        value: description
      });
    }

    const challengeParams = params;
    if (challengeParams.expirationDate) {
      pass.setExpirationDate(new Date(challengeParams.expirationDate));
    }

    if (challengeParams.notBefore) {
      pass.setRelevantDate(new Date(challengeParams.notBefore));
    } else {
      pass.setRelevantDate(new Date());
    }

    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');

    return res.status(200).send(JSON.stringify(pass.getAsBuffer()));
  } catch (e) {
    console.error(e);
    return res.status(500).send({ errorMessage: e.message });
  }
};
