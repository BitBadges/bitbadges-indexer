import { Secp256k1 } from '@cosmjs/crypto';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningStargateClient, assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import {
  BETANET_CHAIN_DETAILS,
  Numberify,
  SupportedChain,
  convertToCosmosAddress,
  createTransactionPayload,
  createTxBroadcastBody,
  generateAlias,
  type TxContext
} from 'bitbadgesjs-sdk';

import {
  MsgTransferBadges as ProtoMsgTransferBadges,
  MsgUniversalUpdateCollection as ProtoMsgUniversalUpdateCollection
} from 'bitbadgesjs-sdk/dist/proto/badges/tx_pb';

import crypto from 'crypto';
import env from 'dotenv';
import { ethers } from 'ethers';
import { serializeError } from 'serialize-error';
import { broadcastTx } from './broadcastUtils';

env.config();

const fromMnemonic = process.env.FAUCET_MNEMONIC ?? '';

// const randomMsgDeleteCollection = () => {
//   return new ProtoMsgDeleteCollection({
//     collectionId: Math.floor(Math.random() * 1000).toString(),
//     creator: convertToCosmosAddress(ethWallet.address)
//   });
// };

//TODO: All other msg types

const randomAddress = () => {
  const randomNum = Math.floor(Math.random() * 50);
  if (randomNum === 0) return 'Mint';
  else return generateAlias('test', [Buffer.from([randomNum])]);
};

const randomUintRangeArray = () => {
  let start = (Math.floor(Math.random() * 100) + 1).toString();
  if (Math.random() < 0.5) start = '1';

  const end = (Number(start) + Math.floor(Math.random() * 100)).toString();
  return [{ start, end }];
};

const randomBalance = () => {
  return {
    amount: Math.floor(Math.random() * 100 + 1).toString(),
    badgeIds: randomUintRangeArray(),
    ownershipTimes: randomUintRangeArray()
  };
};

const randomMsgTransferBadges = (collectionId: string) => {
  return new ProtoMsgTransferBadges({
    creator: convertToCosmosAddress(ethWallet.address),
    collectionId: collectionId,
    transfers: [
      {
        from: randomAddress(),
        toAddresses: [convertToCosmosAddress(ethWallet.address)],
        balances: [
          {
            amount: Math.floor(Math.random() * 100).toString(),
            badgeIds: randomUintRangeArray(),
            ownershipTimes: randomUintRangeArray()
          }
        ]
      }
    ]
  });
};

const randomStringTimeline = (key: string, isArr?: boolean, isAddress?: boolean) => {
  return [
    {
      timelineTimes: randomUintRangeArray(),
      [key]: isArr
        ? [crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')]
        : isAddress
          ? randomAddress()
          : crypto.randomBytes(32).toString('hex')
    }
  ];
};

const randomBoolTimeline = (key: string) => {
  return [
    {
      timelineTimes: randomUintRangeArray(),
      [key]: Math.random() < 0.5
    }
  ];
};

const randomMetadataTimeline = (key: string) => {
  return [
    {
      timelineTimes: randomUintRangeArray(),
      [key]: {
        uri: 'https://' + crypto.randomBytes(32).toString('hex') + '.com/{address}',
        customData: crypto.randomBytes(32).toString('hex')
      }
    }
  ];
};

const randomBadgeMetadataTimeline = (key: string) => {
  return [
    {
      timelineTimes: randomUintRangeArray(),
      [key]: [
        {
          uri: 'https://' + crypto.randomBytes(32).toString('hex') + '.com/{id}',
          customData: crypto.randomBytes(32).toString('hex'),
          badgeIds: randomUintRangeArray()
        }
      ]
    }
  ];
};

const randomMsgCreateCollection = (newCollection?: boolean) => {
  const balancesType = Math.random() < 0.33 ? 'Standard' : Math.random() < 0.66 ? 'Off-Chain - Non-Indexed' : 'Off-Chain - Indexed';

  return new ProtoMsgUniversalUpdateCollection({
    creator: convertToCosmosAddress(ethWallet.address),
    collectionId: newCollection ? '0' : Math.floor(Math.random() * 1000).toString(),
    balancesType: balancesType,
    badgesToCreate: Array.from({ length: 25 }, randomBalance),
    updateCollectionPermissions: newCollection ? true : Math.random() < 0.5,
    updateManagerTimeline: newCollection ? true : Math.random() < 0.5,
    updateCollectionMetadataTimeline: newCollection ? true : Math.random() < 0.5,
    updateBadgeMetadataTimeline: newCollection ? true : Math.random() < 0.5,
    updateOffChainBalancesMetadataTimeline: newCollection ? true : Math.random() < 0.5,
    updateCustomDataTimeline: newCollection ? true : Math.random() < 0.5,
    updateCollectionApprovals: newCollection ? true : Math.random() < 0.5,
    updateStandardsTimeline: newCollection ? true : Math.random() < 0.5,
    updateIsArchivedTimeline: newCollection ? true : Math.random() < 0.5,
    defaultBalances: {
      // balances: Array.from({ length: Math.floor(Math.random() * 10) }, randomBalance),
      balances: [],
      userPermissions: {
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: []
      },
      autoApproveSelfInitiatedIncomingTransfers: Math.random() < 0.5,
      autoApproveSelfInitiatedOutgoingTransfers: Math.random() < 0.5,
      incomingApprovals: [],
      outgoingApprovals: []
    },
    collectionPermissions: {
      canArchiveCollection: [],
      canCreateMoreBadges: [],
      canDeleteCollection: [],
      canUpdateBadgeMetadata: [],
      canUpdateCollectionApprovals: [],
      canUpdateCollectionMetadata: [],
      canUpdateCustomData: [],
      canUpdateManager: [],
      canUpdateOffChainBalancesMetadata: [],
      canUpdateStandards: []
    },
    managerTimeline: randomStringTimeline('manager', false, true),
    customDataTimeline: randomStringTimeline('customData'),
    standardsTimeline: randomStringTimeline('standards', true),
    isArchivedTimeline: randomBoolTimeline('isArchived'),
    collectionApprovals:
      balancesType === 'Standard'
        ? [
            {
              approvalId: crypto.randomBytes(32).toString('hex'),
              challengeTrackerId: crypto.randomBytes(32).toString('hex'),
              amountTrackerId: crypto.randomBytes(32).toString('hex'),
              fromListId: 'All',
              toListId: 'All',
              initiatedByListId: 'All',
              badgeIds: randomUintRangeArray(),
              transferTimes: randomUintRangeArray(),
              ownershipTimes: randomUintRangeArray()
            }
          ]
        : [],
    collectionMetadataTimeline: randomMetadataTimeline('collectionMetadata'),
    badgeMetadataTimeline: randomBadgeMetadataTimeline('badgeMetadata'),
    offChainBalancesMetadataTimeline: balancesType === 'Standard' ? [] : randomMetadataTimeline('offChainBalancesMetadata')
  });
};

const NUM_RUNS = 1000;

async function main() {
  try {
    const chain = { ...BETANET_CHAIN_DETAILS, chain: SupportedChain.ETH };
    let sequence = 0;
    let numSuccesses = 0;
    const successes = [];
    const failures = [];
    for (let i = 0; i < NUM_RUNS; i++) {
      const sender = {
        accountAddress: convertToCosmosAddress(ethWallet.address),
        sequence: sequence,
        accountNumber: Numberify(account.accountNumber),
        pubkey: base64PubKey
      };

      const msgs = [];
      if (i % 2 === 0) {
        msgs.push(randomMsgCreateCollection(true));
      } else {
        msgs.push(randomMsgTransferBadges(Math.floor(Math.random() * 50).toString()));
      }

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
      try {
        console.log('BROADCASTING');
        const res = await broadcastTx(rawTx);
        // console.log(res);
        sequence++;
        if (!res.data.tx_response.code) {
          numSuccesses++;
          successes.push(res);
        } else {
          throw new Error(res.data.tx_response.raw_log);
        }
      } catch (e) {
        failures.push({
          error: serializeError(e),
          msg: msgs.map((x) => x.toJsonString())
        });

        console.log(e);
      }
    }

    console.log('Successes: ', numSuccesses);
    console.log('Failures: ', NUM_RUNS - numSuccesses);

    console.log('Failures', failures);
  } catch (e) {
    console.log(e);
  }
}

// Step 1. Get Tokens from faucet into our new account

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
  denom: 'badge',
  amount: '100000'
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
const ethWallet = ethers.Wallet.createRandom();

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

const sig = await ethWallet.signMessage(message);

const msgHash = ethers.utils.hashMessage(message);
const msgHashBytes = ethers.utils.arrayify(msgHash);
const pubKey = ethers.utils.recoverPublicKey(msgHashBytes, sig);

const pubKeyHex = pubKey.substring(2);
const compressedPublicKey = Secp256k1.compressPubkey(new Uint8Array(Buffer.from(pubKeyHex, 'hex')));
const base64PubKey = Buffer.from(compressedPublicKey).toString('base64');

(async () => {
  await main();
})().catch(console.error);
