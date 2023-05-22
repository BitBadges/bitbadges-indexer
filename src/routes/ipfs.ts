import { AES } from "crypto-js";
import { Request, Response } from "express";
import { PASSWORDS_DB } from "../db/db";
import { addBalancesToIpfs, addClaimToIpfs, addMetadataToIpfs } from "../ipfs/ipfs";

export const addMetadataToIpfsHandler = async (req: Request, res: Response) => {
  try {
    let result = undefined;
    if (req.body.collectionMetadata, req.body.individualBadgeMetadata) {
      result = await addMetadataToIpfs(req.body.collectionMetadata, req.body.individualBadgeMetadata);
    } else if (req.body.balances) {
      result = await addBalancesToIpfs(req.body.balances);
    }

    if (!result) {
      return res.status(400).send({ error: 'No addAll result received' });
    }

    const { path, cid } = result;
    return res.status(200).send({ cid: cid.toString(), path });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: e });
  }
}

export const addClaimToIpfsHandler = async (req: Request, res: Response) => {
  try {
    const result = await addClaimToIpfs(req.body.name, req.body.description, req.body.leavesDetails, req.body.password ? true : false);
    if (!result) {
      return res.status(400).send({ error: 'No addAll result received' });
    }


    const { path, cid } = result;
    const password = req.body.password;

    const SYM_KEY = process.env.SYM_KEY;

    await PASSWORDS_DB.insert({
      collectionId: "-1",
      claimId: "-1",
      docClaimedByCollection: false,
      cid: cid.toString(),
      //Hash + Salt Password
      password: password ? AES.encrypt(password, SYM_KEY).toString() : "",
      //Symmmetric Key Encrypted with Hash + Salt Password
      codes: req.body.codes.map((code: string) => AES.encrypt(code, SYM_KEY).toString()),
      currCode: "0",
      claimedUsers: {}
    });


    return res.status(200).send({ cid: cid.toString(), path });
  } catch (e) {
    console.error(e);
    return res.status(500).send({ error: e });
  }
}