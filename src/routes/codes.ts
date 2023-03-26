import { Request, Response } from "express";
import { ACCOUNTS_DB, COLLECTIONS_DB, PASSWORDS_DB } from "../db/db";
import { AuthenticatedRequest } from "../blockin/blockin_handlers";

export const getCodes = async (expressReq: Request, res: Response) => {
    try {
        const req = expressReq as AuthenticatedRequest

        const collectionId = Number(req.params.collectionId);

        const collection = await COLLECTIONS_DB.get(`${collectionId}`);
        const manager = collection.manager;

        
        const managerAccountInfo = await ACCOUNTS_DB.get(`${manager}`);
        if (managerAccountInfo.cosmosAddress !== req.session.cosmosAddress) {
            return res.status(401).send({ error: 'Unauthorized. Must be manager of this collection.' });
        }


        const codes: string[][] = [];
        const passwords: string[] = [];
        for (let i = 0; i < collection.claims.length; i++) {
            const ipfsURI = collection.claims[i].uri.replace('ipfs://', '');
            try {
                const codesDoc = await PASSWORDS_DB.get(ipfsURI);
                codes.push(codesDoc.codes);
                passwords.push(codesDoc.password);
            } catch {
                codes.push([]);
                passwords.push('');
            }
        }


        return res.status(200).send({ codes, passwords });
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: e });
    }
}