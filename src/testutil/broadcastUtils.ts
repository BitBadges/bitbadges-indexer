import axios from 'axios';
import { generateEndpointBroadcast } from 'bitbadgesjs-sdk/dist/node-rest-api/broadcast';

export const broadcastTx = async (bodyString: string) => {
  const res = await axios.post(`${process.env.API_URL}${generateEndpointBroadcast()}`, bodyString).catch(async (e) => {
    if (e?.response?.data) {
      console.log(e.response.data);

      return await Promise.reject(e.response.data);
    }
    console.log(e);
    return await Promise.reject(e);
  });

  const txHash = res.data.tx_response.txhash;
  const code = res.data.tx_response.code;
  if (code !== undefined && code !== 0) {
    throw new Error(`Error broadcasting transaction: Code ${code}: ${JSON.stringify(res.data.tx_response, null, 2)}`);
  }

  let fetched = false;
  while (!fetched) {
    try {
      const res = await axios.get(`${process.env.API_URL}/cosmos/tx/v1beta1/txs/${txHash}`);
      fetched = true;

      return res;
    } catch (e) {
      // wait 1 sec
      console.log('Waiting 1 sec to fetch tx');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return res;
};
export const removeEIP712Domain = (prevTypes: any) => {
  const newVal = Object.entries(prevTypes)
    .filter(([key]) => key !== 'EIP712Domain')
    .reduce<any>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});

  return newVal;
};
