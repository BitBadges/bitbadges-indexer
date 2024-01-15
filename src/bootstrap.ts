import { Secp256k1 } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { Account, SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import axios from "axios";
import { MessageGenerated, MsgUniversalUpdateCollection, SupportedChain, createTransactionPayload, createTxRawEIP712, signatureToWeb3Extension } from "bitbadgesjs-proto";

import { MsgTransferBadges, MsgCreateAddressLists as ProtoMsgCreateAddressLists, MsgUniversalUpdateCollection as ProtoMsgUniversalUpdateCollection } from 'bitbadgesjs-proto/dist/proto/badges/tx_pb';
import { MsgCreateProtocol as ProtoMsgCreateProtocol } from 'bitbadgesjs-proto/dist/proto/protocols/tx_pb';

import { createProtoMsg } from 'bitbadgesjs-proto/dist/proto-types/base';
import { BETANET_CHAIN_DETAILS, BroadcastMode, Numberify, convertToCosmosAddress, generateEndpointBroadcast, generatePostBodyBroadcast } from "bitbadgesjs-utils";
import crypto from 'crypto';
import env from 'dotenv';
import { ethers } from "ethers";
import fs from 'fs';
import path from 'path';

env.config();

const MANUAL_TRANSFERS = true;
const NUM_MANUAL_TRANSFERS = 1;
const fromMnemonic = process.env.FAUCET_MNEMONIC as string;
// const ADDRESSES_TO_TRANSFER_TO: string[] = ["cosmos1kfr2xajdvs46h0ttqadu50nhu8x4v0tcfn4p0x", "cosmos1rgtvs7f82uprnlkdxsadye20mqtgyuj7n4npzz"];
const ADDRESSES_TO_TRANSFER_TO: string[] = [];

async function main() {
  try {
    const chain = { ...BETANET_CHAIN_DETAILS, chain: SupportedChain.ETH }
    let sequence = 0;
    const sender = {
      accountAddress: convertToCosmosAddress(ethWallet.address),
      sequence: sequence++,
      accountNumber: Numberify(account.accountNumber),
      pubkey: base64PubKey,
    };

    const msgs: MessageGenerated[] = [];
    msgs.push(...bootstrapLists().map(x => createProtoMsg(x)));

    msgs.push(...bootstrapCollections().map(x => createProtoMsg(x)))

    msgs.push(...bootstrapProtocols().map(x => createProtoMsg(x)));

    msgs.push(...bootstrapTransfers().map(x => createProtoMsg(x)));

    const txn = createTransactionPayload({ chain, sender, memo: '', fee: { denom: 'badge', amount: '1', gas: '4000000' } }, msgs);
    if (!txn.eipToSign) throw new Error("No eip to sign");

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
    console.log(res);
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
    generatePostBodyBroadcast(rawTx, BroadcastMode.Sync),
  ).catch((e) => {
    if (e && e.response && e.response.data) {
      console.log(e.response.data);

      return Promise.reject(e.response.data);
    }
    console.log(e);
    return Promise.reject(e);
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
      //wait 1 sec
      console.log('Waiting 1 sec to fetch tx');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

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

export function bootstrapProtocols() {
  const subdirectoryPath = './src/setup/bootstrapped-protocols';

  // Initialize an array to store the parsed JSON objects
  const jsonObjects: any[] = [];
  const jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);

  const msgs = jsonObjects.map((jsonObject, idx) => {
    return new ProtoMsgCreateProtocol({
      ...jsonObject,
      creator: convertToCosmosAddress(ethWallet.address),
    });
  });

  return msgs;

}

export function bootstrapLists() {
  //parse ./helpers/10000_addresses.txt
  const addresses = fs.readFileSync('./src/setup/helpers/10000_addresses.txt', 'utf-8').split('\n').map(x => x.trim()).filter(x => x !== '').map(x => convertToCosmosAddress(x));

  // Specify the subdirectory path
  const subdirectoryPath = './src/setup/bootstrapped-lists';

  // Initialize an array to store the parsed JSON objects
  const jsonObjects: any[] = [];
  const jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);


  const msgs = [];
  for (let i = 0; i < jsonObjects.length; i++) {
    const msg1 = new ProtoMsgCreateAddressLists({
      creator: convertToCosmosAddress(ethWallet.address),
      addressLists: [{

        ...jsonObjects[i],
        listId: jsonFileNames[i].split('_')[1].split('.')[0] + '-' + crypto.randomBytes(32).toString('hex'),
        //random bool
        whitelist: Math.random() < 0.5,

      }, {
        ...jsonObjects[i],
        listId: jsonFileNames[i].split('_')[1].split('.')[0] + '-' + crypto.randomBytes(32).toString('hex'),
        addresses: addresses.slice(0, 1000),
        whitelist: Math.random() < 0.5,
      }]
    });

    msgs.push(msg1);
  }
  // }

  return msgs;
}

export function bootstrapTransfers() {

  const transferMsgs = []
  if (MANUAL_TRANSFERS) {
    for (let j = 1; j <= NUM_MANUAL_TRANSFERS; j++) {
      if (j % 10 === 0) console.log("Transfer", j);

      let toAddress = '';
      if (ADDRESSES_TO_TRANSFER_TO.length > 0) {
        const numTransfersPerAddress = NUM_MANUAL_TRANSFERS / ADDRESSES_TO_TRANSFER_TO.length;
        const addressIdx = Math.floor((j - 1) / numTransfersPerAddress);
        toAddress = ADDRESSES_TO_TRANSFER_TO[addressIdx];
      } else {
        const toWallet = ethers.Wallet.createRandom();
        toAddress = convertToCosmosAddress(toWallet.address);
      }
      console.log(toAddress);

      transferMsgs.push(new MsgTransferBadges({
        creator: convertToCosmosAddress(ethWallet.address),
        collectionId: "9",
        transfers: [
          {
            from: "Mint",
            toAddresses: [toAddress],
            balances: [{
              amount: '1',
              badgeIds: [{ start: j.toString(), end: j.toString() }],
              ownershipTimes: [{ start: "1", end: "18446744073709551615" }]
            }]
          }
        ]
      })
      );
    }
  }

  return transferMsgs;
}



export function bootstrapCollections() {
  const subdirectoryPath = './src/setup/bootstrapped-collections';

  // Initialize an array to store the parsed JSON objects
  let jsonObjects: any[] = [];
  let jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);
  const jointJsonObjects = jsonObjects.map((jsonObject, idx) => {
    return {
      object: jsonObject,
      fileName: jsonFileNames[idx]
    }
  }).sort((a, b) => {
    const aNum = Number(a.fileName.split('_')[0]);
    const bNum = Number(b.fileName.split('_')[0]);

    return aNum - bNum;
  });

  jsonFileNames = jointJsonObjects.map((jsonObject) => jsonObject.fileName);
  jsonObjects = jointJsonObjects.map((jsonObject) => jsonObject.object);


  const msgs: ProtoMsgUniversalUpdateCollection[] = [];

  for (let i = 0; i < jsonObjects.length; i++) {
    console.log(jsonFileNames[i]);
    if (jsonFileNames[i].startsWith('1_')) continue
    else if (jsonFileNames[i].startsWith('15_')) continue


    const obj = {
      ...jsonObjects[i],
      creator: convertToCosmosAddress(ethWallet.address),
      managerTimeline: jsonFileNames[i] === "9_10000_manual_transfers.json" ? [{
        timelineTimes: [{ start: "1", end: Number.MAX_SAFE_INTEGER.toString() }],
        manager: convertToCosmosAddress(ethWallet.address)
      }] : jsonObjects[i].managerTimeline,
      collectionApprovals: jsonFileNames[i] === "9_10000_manual_transfers.json" ?
        jsonObjects[i].collectionApprovals.map((x: any, idx: any) => {
          if (idx == 0) {
            return { ...x, initiatedByListId: convertToCosmosAddress(ethWallet.address) }
          } else return x
        }) : jsonObjects[i].collectionApprovals,
      // inheritedCollectionId: jsonFileNames[i] === "12_inherited.json" ? manualTransfersId : jsonObjects[i].inheritedCollectionId,
    } as Required<MsgUniversalUpdateCollection<string>>

    const msg = new ProtoMsgUniversalUpdateCollection({
      ...obj,
      creator: obj.creator,
    });

    msgs.push(msg);
  }

  return msgs;
}

main()