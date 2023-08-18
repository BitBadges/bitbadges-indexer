import { Secp256k1 } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import axios from "axios";
import { Numberify, createTxMsgTransferBadges, createTxMsgUpdateCollection, createTxRawEIP712, signatureToWeb3Extension } from "bitbadgesjs-proto";
import { BroadcastMode, generateEndpointBroadcast, generatePostBodyBroadcast } from "bitbadgesjs-provider";
import { BETANET_CHAIN_DETAILS, convertToCosmosAddress } from "bitbadgesjs-utils";
import { ethers } from "ethers";
// import { connect } from '@wagmi/core'

const fs = require('fs');
const path = require('path');

//require .env
require('dotenv').config();

async function main() {
  try {
    await bootstrapCollections();
  } catch (e) {
    console.log(e);
  }
}


export async function bootstrapCollections() {
  const fromMnemonic = process.env.FAUCET_MNEMONIC as string;

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


  const account = await signingClient.getAccount(convertToCosmosAddress(ethWallet.address));
  if (!account) throw new Error('Account not found');

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

  // Specify the subdirectory path
  const subdirectoryPath = './src/setup/bootstrapped-collections';

  // Initialize an array to store the parsed JSON objects
  const jsonObjects: any[] = [];
  const jsonFileNames: string[] = [];

  // Call the function to get and parse .json files from the subdirectory
  getAndParseJsonFiles(subdirectoryPath, jsonObjects, jsonFileNames);


  //Step 3. Buiild andbroadcast transactions
  const manualTransfers = true;
  let sequence = 0;
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

    // console.log(sender);
    // console.log(txn.eipToSign);

    //remove EIP712Domain from types
    const newVal = Object.entries(txn.eipToSign.types).filter(([key, value]) => key !== 'EIP712Domain').reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {} as any);

    let sig = await ethWallet._signTypedData(
      txn.eipToSign.domain as any,
      newVal,
      txn.eipToSign.message as any
    );

    let txnExtension = signatureToWeb3Extension(chain, sender, sig)

    // Create the txRaw
    let rawTx = createTxRawEIP712(
      txn.legacyAmino.body,
      txn.legacyAmino.authInfo,
      txnExtension,
    )



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

    console.log("Created Collection", i + 1);

    //Parse the number value from {"key":"collectionId","value":"161"}
    // console.log(res.data.tx_response.raw_log.find("collectionId"));
    const rawLog = JSON.parse(res.data.tx_response.raw_log);
    // console.log(rawLog[0].events);
    const collectionId = rawLog[0].events[0].attributes.find((log: any) => log.key === 'collectionId').value;
    // console.log(collectionId);

    console.log(jsonFileNames[i]);

    if (jsonFileNames[i] === "9_10000_manual_transfers.json" && !manualTransfers) continue;
    else if (jsonFileNames[i] === "9_10000_manual_transfers.json") {
      for (let j = 1; j <= 20; j++) {
        if (j % 10 === 0) console.log("Transfer", j);
        const toWallet = ethers.Wallet.createRandom();

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
                toAddresses: [convertToCosmosAddress(toWallet.address)],
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

        // console.log(transferTxn.eipToSign);

        //remove EIP712Domain from types
        const newVal = Object.entries(transferTxn.eipToSign.types).filter(([key, value]) => key !== 'EIP712Domain').reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }
          , {} as any);

        let sig = await ethWallet._signTypedData(
          transferTxn.eipToSign.domain as any,
          newVal,
          transferTxn.eipToSign.message as any
        );

        let txnExtension = signatureToWeb3Extension(chain, sender, sig)

        // Create the txRaw
        let rawTx = createTxRawEIP712(
          transferTxn.legacyAmino.body,
          transferTxn.legacyAmino.authInfo,
          txnExtension,
        )

        // console.log(sequence);

        const res =
          await axios.post(
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

        console.log(res);

        // assertIsDeliverTxSuccess(result);
      }
    }
  }

}

main()