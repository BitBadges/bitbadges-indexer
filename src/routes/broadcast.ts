import axios from "axios";
import { generateEndpointBroadcast } from "bitbadgesjs-provider";
import { BroadcastTxRouteRequestBody, BroadcastTxRouteResponse, SimulateTxRouteResponse, NumberType } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";

export const broadcastTx = async (req: Request, res: Response<BroadcastTxRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as BroadcastTxRouteRequestBody;

    const broadcastPost = await axios.post(
      `${process.env.API_URL}${generateEndpointBroadcast()}`,
      reqBody,
    ).catch((e) => {
      if (e && e.response && e.response.data) {
        return Promise.reject(e.response.data);
      }
      return Promise.reject(e);
    });

    return res.status(200).send(broadcastPost.data);
  } catch (e) {
    console.error(e);

    //Return message up until first '['
    const message = e.message.split('[')[0];

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
    const message = e.message;

    return res.status(500).send({
      error: serializeError(e),
      message: 'Error simulating transaction: ' + message
    });
  }
}