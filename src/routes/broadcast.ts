import axios from "axios";
import { generateEndpointBroadcast } from "bitbadgesjs-provider";
import { BroadcastTxRouteRequestBody, BroadcastTxRouteResponse, SimulateTxRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { DEV_MODE } from "../constants";

export const broadcastTx = async (req: Request, res: Response<BroadcastTxRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as BroadcastTxRouteRequestBody;

    const initialRes = await axios.post(
      `${process.env.API_URL}${generateEndpointBroadcast()}`,
      reqBody,
    ).catch((e) => {
      if (e && e.response && e.response.data) {
        return Promise.reject(e.response.data);
      }
      return Promise.reject(e);
    });
    const txHash = initialRes.data.tx_response.txhash;
    const code = initialRes.data.tx_response.code;
    if (code !== undefined && code !== 0) {
      throw new Error(`Error broadcasting transaction: Code ${code}: ${JSON.stringify(initialRes.data.tx_response, null, 2)}`);
    }

    let fetchResponse = null
    let numTries = 0;
    while (!fetchResponse) {
      try {
        const res = await axios.get(`${process.env.API_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
        fetchResponse = res;
      } catch (e) {
        //wait 1 sec
        console.log("Waiting 1 second for transaction to be included in block...");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        numTries++;
        if (numTries > 30) {
          throw new Error('Transaction not included in block after 30 seconds. Please try again later.');
        }
      }
    }

    return res.status(200).send(fetchResponse.data);
  } catch (e) {
    console.error(e);

    const message = DEV_MODE ? e.message : e.message.split("[/")[0];

    return res.status(500).send({
      error: serializeError(e),
      message: 'Error broadcasting transaction: ' + message
    });
  }
}

export const simulateTx = async (req: Request, res: Response<SimulateTxRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as BroadcastTxRouteRequestBody;

    const simulatePost = await axios.post(
      `${process.env.API_URL}${"/cosmos/tx/v1beta1/simulate"}`,
      reqBody,
    ).catch((e) => {
      if (e && e.response && e.response.data) {
        return Promise.reject(e.response.data);
      }
      return Promise.reject(e);
    });

    return res.status(200).send(simulatePost.data);
  } catch (e) {
    console.error(e);
    const message = DEV_MODE ? e.message : e.message.split("[/")[0];

    return res.status(500).send({
      error: serializeError(e),
      message: 'Error simulating transaction: ' + message
    });
  }
}