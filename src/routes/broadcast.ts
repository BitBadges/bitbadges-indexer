import axios from "axios";
import { generateEndpointBroadcast } from "bitbadgesjs-provider";
import { Request, Response } from "express";

export const broadcastTx = async (req: Request, res: Response) => {
    try {
        const broadcastPost = await axios.post(
            `${process.env.API_URL}${generateEndpointBroadcast()}`,
            req.body,
        );

        return res.status(200).send(broadcastPost);
    } catch (e) {
        console.error(e);
        return res.status(500).send({ error: 'Error broadcasting' });
    }
}