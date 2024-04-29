import { BigIntify } from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString } from 'blockin';
import { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
// For running tests (TS bugs out)
// import { PKPass } from 'passkit-generator';

// For running
import passkit from 'passkit-generator';
const { PKPass } = passkit;

const certDirectory = path.resolve(process.cwd(), 'cert');
const wwdr = fs.readFileSync(path.join(certDirectory, 'wwdr.pem'));
const signerCert = fs.readFileSync(path.join(certDirectory, 'signerCert.pem'));
const signerKey = fs.readFileSync(path.join(certDirectory, 'signerKey.key'));

export const createPass = async (req: Request, res: Response<any>) => {
  try {
    const { name, description, signature, message } = req.body;

    const passID = signature;

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

    const challengeParams = constructChallengeObjectFromString(message, BigIntify);
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
