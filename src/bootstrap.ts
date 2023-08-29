import { Secp256k1 } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Account, SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import axios from "axios";
import { Numberify, createTxMsgCreateAddressMappings, createTxMsgTransferBadges, createTxMsgUpdateCollection, createTxRawEIP712, signatureToWeb3Extension } from "bitbadgesjs-proto";
import { BroadcastMode, generateEndpointBroadcast, generatePostBodyBroadcast } from "bitbadgesjs-provider";
import { BETANET_CHAIN_DETAILS, convertToCosmosAddress } from "bitbadgesjs-utils";
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';
import env from 'dotenv';
import crypto from 'crypto';

env.config();

const MANUAL_TRANSFERS = true;
const NUM_MANUAL_TRANSFERS = 20;
const fromMnemonic = process.env.FAUCET_MNEMONIC as string;
const ADDRESSES_TO_TRANSFER_TO: string[] = ["cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x", "cosmos1rgtvs7f82uprnlkdxsadye20mqtgyuj7n4npzz"];

async function main() {
  try {
    await bootstrapLists();
    await bootstrapCollections();
  } catch (e) {
    console.log(e);
  }
}

const removeEIP712Domain = (prevTypes: any) => {
  const newVal = Object.entries(prevTypes).filter(([key, value]) => key !== 'EIP712Domain').reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }
    , {} as any);

  return newVal;
}


const broadcastTx = async (rawTx: any) => {
  const res = await axios.post(
    `${process.env.API_URL}${generateEndpointBroadcast()}`,
    generatePostBodyBroadcast(rawTx, BroadcastMode.Block),
  ).catch((e) => {
    if (e && e.response && e.response.data) {
      console.log(e.response.data);

      return Promise.reject(e.response.data);
    }
    console.log(e);
    return Promise.reject(e);
  });

  return res;
}

//Step 1. Get Tokens from faucet into our new account

//Get cosmos address form mnemonic
const wallet = await DirectSecp256k1HdWallet.fromMnemonic(fromMnemonic);
const [firstAccount] = await wallet.getAccounts();

const rpcs = JSON.parse(process.env.RPC_URLS || '["http://localhost:26657"]') as string[]

let signingClient;
for (let i = 0; i < rpcs.length; i++) {
  try {
    signingClient = await SigningStargateClient.connectWithSigner(
      rpcs[i],
      wallet
    );
    break;
  } catch (e) {
    console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`)
  }
}

if (!signingClient) {
  throw new Error('Could not connect to any RPCs');
}

const amount = {
  denom: "badge",
  amount: "100000",
};


const fee = {
  amount: [
    {
      denom: "badge",
      amount: "1",
    },
  ],
  gas: "180000",
};
const ethWallet = ethers.Wallet.createRandom();

const result = await signingClient.sendTokens(firstAccount.address, convertToCosmosAddress(ethWallet.address), [amount], fee);
assertIsDeliverTxSuccess(result);


const account = await signingClient.getAccount(convertToCosmosAddress(ethWallet.address)) as Account;

//Step 2. Get the public key for the account

const message = "Hello! We noticed that you haven't used the BitBadges blockchain yet. To interact with the BitBadges blockchain, we need your public key for your address to allow us to generate transactions.\n\nPlease kindly sign this message to allow us to compute your public key.\n\nNote that this message is not a blockchain transaction and signing this message has no purpose other than to compute your public key.\n\nThanks for your understanding!"

const sig = await ethWallet.signMessage(message);

const msgHash = ethers.utils.hashMessage(message);
const msgHashBytes = ethers.utils.arrayify(msgHash);
const pubKey = ethers.utils.recoverPublicKey(msgHashBytes, sig);


const pubKeyHex = pubKey.substring(2);
const compressedPublicKey = Secp256k1.compressPubkey(new Uint8Array(Buffer.from(pubKeyHex, 'hex')));
const base64PubKey = Buffer.from(compressedPublicKey).toString('base64');

function getAndParseJsonFiles(directoryPath: string, jsonObjects: any[], jsonFileNames: string[]): void {
  const files = fs.readdirSync(directoryPath);

  files.forEach((file: any) => {
    const filePath = path.join(directoryPath, file);
    const fileStat = fs.statSync(filePath);

    if (fileStat.isDirectory()) {
      getAndParseJsonFiles(filePath, jsonObjects, jsonFileNames); // Recurse into subdirectory
    } else if (file.endsWith('.json')) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const jsonObject = JSON.parse(fileContent);
        jsonObjects.push(jsonObject);
        jsonFileNames.push(file);
      } catch (error) {
        console.error(`Error parsing ${filePath}: ${error.message}`);
      }
    }
  });
}

export async function bootstrapLists() {
  //parse ./helpers/10000_addresses.txt
  const addresses = fs.readFileSync('./src/setup/helpers/10000_addresses.txt', 'utf-8').split('\n').map(x => x.trim()).filter(x => x !== '').map(x => convertToCosmosAddress(x));

  // Specify the subdirectory path
  const subdirectoryPath = './src/setup/bootstrapped-lists';

  // Initialize an array to store the parsed JSON objects
  const jsonObjects: any[] = [];
  const jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);


  //Step 3. Buiild andbroadcast transactions
  let sequence = 0;

  // for (let i = 0; i < 100000; i++) {
  // console.log(jsonObjects.length);
  for (let i = 0; i < jsonObjects.length; i++) {
    const chain = BETANET_CHAIN_DETAILS;
    const sender = {
      accountAddress: convertToCosmosAddress(ethWallet.address),
      sequence: sequence++,
      accountNumber: Numberify(account.accountNumber),
      pubkey: base64PubKey,
    };

    const txn = createTxMsgCreateAddressMappings(
      chain,
      sender,
      {
        denom: 'badge',
        amount: '1',
        gas: '2000000',
      },
      '',
      {
        creator: convertToCosmosAddress(ethWallet.address),
        addressMappings: [{
          ...jsonObjects[i],
          mappingId: jsonFileNames[i].split('_')[1].split('.')[0] + '-' + crypto.randomBytes(32).toString('hex'),
          //random bool
          includeAddresses: Math.random() < 0.5,
        }, {
          ...jsonObjects[i],
          mappingId: jsonFileNames[i].split('_')[1].split('.')[0] + '-' + crypto.randomBytes(32).toString('hex'),
          addresses: addresses.slice(0, 1000),
          includeAddresses: Math.random() < 0.5,
        }]
      }
    );


    let sig = await ethWallet._signTypedData(
      txn.eipToSign.domain as any,
      removeEIP712Domain(txn.eipToSign.types),
      txn.eipToSign.message as any
    );

    let txnExtension = signatureToWeb3Extension(chain, sender, sig)

    // Create the txRaw
    let rawTx = createTxRawEIP712(
      txn.legacyAmino.body,
      txn.legacyAmino.authInfo,
      txnExtension,
    )

    await broadcastTx(rawTx);
    console.log(jsonFileNames[i]);
    console.log("Created List", i + 1);
    // console.log(res);
  }
  // }
}



export async function bootstrapCollections() {
  const subdirectoryPath = './src/setup/bootstrapped-collections';

  // Initialize an array to store the parsed JSON objects
  const jsonObjects: any[] = [];
  const jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);


  //Step 3. Buiild andbroadcast transactions
  let sequence = 1;
  // console.log(jsonObjects.length);
  for (let i = 0; i < jsonObjects.length; i++) {

    const chain = BETANET_CHAIN_DETAILS;
    const sender = {
      accountAddress: convertToCosmosAddress(ethWallet.address),
      sequence: sequence++,
      accountNumber: Numberify(account.accountNumber),
      pubkey: base64PubKey,
    };

    const txn = createTxMsgUpdateCollection(
      chain,
      sender,
      {
        denom: 'badge',
        amount: '1',
        gas: '180000',
      },
      '',
      {
        ...jsonObjects[i],
        creator: convertToCosmosAddress(ethWallet.address),
        managerTimeline: jsonFileNames[i] === "9_10000_manual_transfers.json"
          ? [{
            timelineTimes: [{ start: "1", end: Number.MAX_SAFE_INTEGER.toString() }],
            manager: convertToCosmosAddress(ethWallet.address)
          }] : jsonObjects[i].managerTimeline
      }
    );


    let sig = await ethWallet._signTypedData(
      txn.eipToSign.domain as any,
      removeEIP712Domain(txn.eipToSign.types),
      txn.eipToSign.message as any
    );

    let txnExtension = signatureToWeb3Extension(chain, sender, sig)

    // Create the txRaw
    let rawTx = createTxRawEIP712(
      txn.legacyAmino.body,
      txn.legacyAmino.authInfo,
      txnExtension,
    )

    const res = await broadcastTx(rawTx);
    console.log(jsonFileNames[i]);
    console.log("Created Collection", i + 1);
    // console.log(res);
    const rawLog = JSON.parse(res.data.tx_response.raw_log);
    const collectionId = rawLog[0].events[0].attributes.find((log: any) => log.key === 'collectionId').value;



    //Handle the manual transfers collection. Creates an on-chain collection w/ 10000 badges and transfers those badges to random or specified addresses
    if (jsonFileNames[i] === "9_10000_manual_transfers.json" && !MANUAL_TRANSFERS) continue;
    else if (jsonFileNames[i] === "9_10000_manual_transfers.json") {
      for (let j = 1; j <= NUM_MANUAL_TRANSFERS; j++) {
        if (j % 10 === 0) console.log("Transfer", j);

        let toAddress = '';
        if (ADDRESSES_TO_TRANSFER_TO.length > 0) {
          toAddress = ADDRESSES_TO_TRANSFER_TO[j % ADDRESSES_TO_TRANSFER_TO.length];
        } else {

          const toWallet = ethers.Wallet.createRandom();
          toAddress = convertToCosmosAddress(toWallet.address);
        }

        const transferTxn = createTxMsgTransferBadges(
          chain,
          {
            accountAddress: convertToCosmosAddress(ethWallet.address),
            sequence: sequence++,
            accountNumber: Numberify(account.accountNumber),
            pubkey: base64PubKey,
          },
          {
            denom: 'badge',
            amount: '1',
            gas: '180000',
          },
          '',
          {
            creator: convertToCosmosAddress(ethWallet.address),
            collectionId: collectionId.toString(),
            transfers: [
              {
                from: "Mint",
                toAddresses: [toAddress],
                balances: [{
                  amount: '1',
                  badgeIds: [{ start: j.toString(), end: j.toString() }],
                  ownershipTimes: [{ start: "1", end: "18446744073709551615" }]
                }],
                precalculationDetails: {
                  approvalId: '',
                  approvalLevel: '',
                  approverAddress: '',
                },
                merkleProofs: [],
                memo: '',
              }
            ]

          }
        );


        let sig = await ethWallet._signTypedData(
          transferTxn.eipToSign.domain as any,
          removeEIP712Domain(transferTxn.eipToSign.types),
          transferTxn.eipToSign.message as any
        );

        let txnExtension = signatureToWeb3Extension(chain, sender, sig)

        // Create the txRaw
        let rawTx = createTxRawEIP712(
          transferTxn.legacyAmino.body,
          transferTxn.legacyAmino.authInfo,
          txnExtension,
        )
        await broadcastTx(rawTx);

      }
    }
  }

}

main()