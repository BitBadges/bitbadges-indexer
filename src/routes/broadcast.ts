import axios from 'axios';
import { type BroadcastTxPayload, type ErrorResponse, type iBroadcastTxSuccessResponse, type iSimulateTxSuccessResponse } from 'bitbadgesjs-sdk';
import { generateEndpointBroadcast } from 'bitbadgesjs-sdk/dist/node-rest-api/broadcast';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';

// Cleans up the generated Cosmos SDK error messages into a more applicable format
// Goal is for it to be human readable and understandable while also being informative
async function tidyErrorMessage(originalMessage: string) {
  // const message = DEV_MODE ? originalMessage : originalMessage.split('[/')[0];
  // const words = message.split(' ');

  // const newWords = [];
  // for (const word of words) {
  //   const punctuation = word[word.length - 1];
  //   let wordWithoutPunctuation = word;
  //   if (punctuation === '.' || punctuation === ',' || punctuation === '!' || punctuation === '?') {
  //     wordWithoutPunctuation = word.slice(0, word.length - 1);
  //   }

  //   if (wordWithoutPunctuation.startsWith('cosmos') && isAddressValid(wordWithoutPunctuation, SupportedChain.COSMOS)) {
  //     const blankExpressRequest: Request = {
  //       body: {},
  //       params: {},
  //       query: {}
  //     } as any;

  //     const account = await getAccountByAddress(blankExpressRequest, wordWithoutPunctuation);
  //     if (account) {
  //       // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  //       newWords.push((account.username || account.resolvedName || account.address) + punctuation);
  //     } else {
  //       newWords.push(word);
  //     }
  //   } else {
  //     newWords.push(word);
  //   }
  // }

  // return newWords.join(' ');

  return originalMessage;
}

export const broadcastTx = async (req: Request, res: Response<iBroadcastTxSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as BroadcastTxPayload;

    const initialRes = await axios.post(`${process.env.API_URL}${generateEndpointBroadcast()}`, reqPayload).catch(async (e) => {
      if (e?.response?.data) {
        return await Promise.reject(e.response.data);
      }
      return await Promise.reject(e);
    });
    const txHash = initialRes.data.tx_response.txhash;
    const code = initialRes.data.tx_response.code;
    if (code !== undefined && code !== 0) {
      throw new Error(`Error broadcasting transaction: Code ${code}: ${JSON.stringify(initialRes.data.tx_response, null, 2)}`);
    }

    let fetchResponse = null;
    let numTries = 0;
    while (!fetchResponse) {
      try {
        const res = await axios.get(`${process.env.API_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
        fetchResponse = res;
      } catch (e) {
        // wait 1 sec
        // console.log("Waiting 1 second for transaction to be included in block...");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        numTries++;
        if (numTries > 30) {
          throw new Error('Transaction not included in block after 30 seconds.');
        }
      }
    }

    return res.status(200).send(fetchResponse.data);
  } catch (e) {
    console.error(e);

    try {
      const message = await tidyErrorMessage(e.message);

      return res.status(500).send({
        error: serializeError(e),
        errorMessage: 'Error broadcasting transaction: ' + message
      });
    } catch (e) {
      return res.status(500).send({
        error: serializeError(e),
        errorMessage: 'Error broadcasting transaction: ' + e.message
      });
    }
  }
};

export const simulateTx = async (req: Request, res: Response<iSimulateTxSuccessResponse | ErrorResponse>) => {
  try {
    const reqPayload = req.body as BroadcastTxPayload;

    const simulatePost = await axios.post(`${process.env.API_URL}${'/cosmos/tx/v1beta1/simulate'}`, reqPayload).catch(async (e) => {
      if (e?.response?.data) {
        return await Promise.reject(e.response.data);
      }
      return await Promise.reject(e);
    });

    return res.status(200).send(simulatePost.data);
  } catch (e) {
    console.error(e);

    try {
      const message = await tidyErrorMessage(e.message);

      return res.status(500).send({
        error: serializeError(e),
        errorMessage: 'Error simulating transaction: ' + message
      });
    } catch (e) {
      return res.status(500).send({
        error: serializeError(e),
        errorMessage: 'Error simulating transaction: ' + e.message
      });
    }
  }
};
