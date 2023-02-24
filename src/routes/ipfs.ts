import { Request, Response } from "express";
import { addMerkleTreeToIpfs, addToIpfs } from "../ipfs/ipfs";

export const addToIpfsHandler = async (req: Request, res: Response) => {
    const result = await addToIpfs(req.body.collectionMetadata, req.body.individualBadgeMetadata);

    if (!result) {
        return res.status(400).send({ error: 'No addAll result received' });
    }

    const { path, cid } = result;
    return res.status(200).send({ cid: cid.toString(), path });
}

export const addMerkleTreeToIpfsHandler = async (req: Request, res: Response) => {
    const result = await addMerkleTreeToIpfs(req.body.leaves);
    if (!result) {
        return res.status(400).send({ error: 'No addAll result received' });
    }

    const { path, cid } = result;
    return res.status(200).send({ cid: cid.toString(), path });
}