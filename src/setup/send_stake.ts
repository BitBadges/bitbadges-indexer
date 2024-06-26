import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { convertToCosmosAddress } from 'bitbadgesjs-sdk';

import env from 'dotenv';

env.config();

const fromMnemonic = process.env.FAUCET_MNEMONIC ?? '';

// Get cosmos address form mnemonic
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
  denom: 'ustake',
  amount: '' //TODO:
};

const fee = {
  amount: [
    {
      denom: 'ubadge',
      amount: '1'
    }
  ],
  gas: '180000'
};

const recipientAddress = ''; //TODO:

const result = await signingClient.sendTokens(firstAccount.address, convertToCosmosAddress(recipientAddress), [amount], fee);
assertIsDeliverTxSuccess(result);
