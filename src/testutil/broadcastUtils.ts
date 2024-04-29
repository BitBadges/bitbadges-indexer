import { Secp256k1 } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import axios from 'axios';
import {
  BETANET_CHAIN_DETAILS,
  Numberify,
  SupportedChain,
  convertToCosmosAddress,
  createTransactionPayload,
  createTxBroadcastBody,
  type TxContext
} from 'bitbadgesjs-sdk';
import { generateEndpointBroadcast } from 'bitbadgesjs-sdk/dist/node-rest-api/broadcast';
import env from 'dotenv';
import { ethers } from 'ethers';

env.config();

export async function signAndBroadcast(msgs: any[], ethWallet: ethers.Wallet) {
  try {
    const fromMnemonic = process.env.FAUCET_MNEMONIC ?? '';

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(fromMnemonic);
    const [firstAccount] = await wallet.getAccounts();

    const rpcs = JSON.parse(process.env.RPC_URLS ?? '["http://localhost:26657"]') as string[];

    let signingClient;
    for (let i = 0; i < rpcs.length; i++) {
      try {
        signingClient = await SigningStargateClient.connectWithSigner(rpcs[i], wallet);
        break;
      } catch (e) {
        console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`);
      }
    }

    if (!signingClient) {
      throw new Error('Could not connect to any RPCs');
    }

    const amount = {
      denom: 'badge',
      amount: '1000'
    };

    const fee = {
      amount: [
        {
          denom: 'badge',
          amount: '1'
        }
      ],
      gas: '180000'
    };
    const result = await signingClient.sendTokens(firstAccount.address, convertToCosmosAddress(ethWallet.address), [amount], fee);
    assertIsDeliverTxSuccess(result);

    const _account = await signingClient.getAccount(convertToCosmosAddress(ethWallet.address));
    if (!_account) {
      throw new Error('Account not found');
    }
    const account = _account;

    // Step 2. Get the public key for the account

    const message =
      "Hello! We noticed that you haven't used the BitBadges blockchain yet. To interact with the BitBadges blockchain, we need your public key for your address to allow us to generate transactions.\n\nPlease kindly sign this message to allow us to compute your public key.\n\nNote that this message is not a blockchain transaction and signing this message has no purpose other than to compute your public key.\n\nThanks for your understanding!";

    const messageSig = await ethWallet.signMessage(message);

    const msgHash = ethers.utils.hashMessage(message);
    const msgHashBytes = ethers.utils.arrayify(msgHash);
    const pubKey = ethers.utils.recoverPublicKey(msgHashBytes, messageSig);

    const pubKeyHex = pubKey.substring(2);
    const compressedPublicKey = Secp256k1.compressPubkey(new Uint8Array(Buffer.from(pubKeyHex, 'hex')));
    const base64PubKey = Buffer.from(compressedPublicKey).toString('base64');

    const chain = { ...BETANET_CHAIN_DETAILS, chain: SupportedChain.ETH };
    let sequence = 0;
    const sender = {
      accountAddress: convertToCosmosAddress(ethWallet.address),
      sequence: sequence++,
      accountNumber: Numberify(account.accountNumber),
      pubkey: base64PubKey
    };

    const txContext: TxContext = {
      chain,
      sender,
      memo: '',
      fee: { denom: 'badge', amount: '1', gas: '40000000' }
    };
    const txn = createTransactionPayload(txContext, msgs);
    if (!txn.eipToSign) throw new Error('No eip to sign');

    const sig = await ethWallet.signMessage(txn.jsonToSign);

    const rawTx = createTxBroadcastBody(txContext, txn, sig);
    const res = await broadcastTx(rawTx);
    console.log(res);

    return res;
  } catch (e) {
    console.log(e);
    throw e;
  }
}

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
