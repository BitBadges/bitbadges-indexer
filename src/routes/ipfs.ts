import { Request, Response } from "express";
import { addMerkleTreeToIpfs, addToIpfs, addBalancesToIpfs } from "../ipfs/ipfs";
import { PASSWORDS_DB } from "../db/db";

export const addToIpfsHandler = async (req: Request, res: Response) => {
    try {
        let result = undefined;
        if (req.body.collectionMetadata, req.body.individualBadgeMetadata) {
          result = await addToIpfs(req.body.collectionMetadata, req.body.individualBadgeMetadata);
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

export const addMerkleTreeToIpfsHandler = async (req: Request, res: Response) => {
    try {
        //Initial sanity check
        const result = await addMerkleTreeToIpfs(req.body.name, req.body.description ,req.body.leaves, req.body.addresses, req.body.hashedCodes, req.body.password ? true : false);
        if (!result) {
            return res.status(400).send({ error: 'No addAll result received' });
        }

        const { path, cid } = result;
        const password = req.body.password;
        await PASSWORDS_DB.insert({ collectionId: -1, claimId: -1, docClaimedByCollection: false, cid: cid.toString(), password, codes: req.body.codes, currCode: 0, claimedUsers: {} });

        return res.status(200).send({ cid: cid.toString(), path });
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}