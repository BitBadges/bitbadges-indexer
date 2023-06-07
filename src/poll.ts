import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { DecodedTxRaw, decodeTxRaw } from "@cosmjs/proto-signing"
import { Block, IndexedTx } from "@cosmjs/stargate"
import * as tx from 'bitbadgesjs-proto/dist/proto/badges/tx'
import { convertFromProtoToMsgClaimBadge, convertFromProtoToMsgDeleteCollection, convertFromProtoToMsgMintAndDistributeBadges, convertFromProtoToMsgNewCollection, convertFromProtoToMsgRequestTransferManager, convertFromProtoToMsgSetApproval, convertFromProtoToMsgTransferBadge, convertFromProtoToMsgTransferManager, convertFromProtoToMsgUpdateAllowedTransfers, convertFromProtoToMsgUpdateBytes, convertFromProtoToMsgUpdatePermissions, convertFromProtoToMsgUpdateUris } from 'bitbadgesjs-transactions'
import { BigIntify, StatusDoc, DocsCache, convertStatusDoc } from "bitbadgesjs-utils"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ERRORS_DB } from "./db/db"
import { getStatus } from "./db/status"
import { client, setClient, setTimer } from "./indexer"
import { fetchUrisFromQueue, purgeQueueDocs } from "./metadata-queue"
import { handleMsgClaimBadge } from "./tx-handlers/handleMsgClaimBadge"
import { handleMsgDeleteCollection } from "./tx-handlers/handleMsgDeleteCollection"
import { handleMsgMintAndDistributeBadges } from "./tx-handlers/handleMsgMintAndDistributeBadges"
import { handleMsgNewCollection } from "./tx-handlers/handleMsgNewCollection"
import { handleMsgRequestTransferManager } from "./tx-handlers/handleMsgRequestTransferManager"
import { handleMsgSetApproval } from "./tx-handlers/handleMsgSetApproval"
import { handleMsgTransferBadge } from "./tx-handlers/handleMsgTransferBadge"
import { handleMsgTransferManager } from "./tx-handlers/handleMsgTransferManager"
import { handleMsgUpdateAllowedTransfers } from "./tx-handlers/handleMsgUpdateAllowedTransfers"
import { handleMsgUpdateBytes } from "./tx-handlers/handleMsgUpdateBytes"
import { handleMsgUpdatePermissions } from "./tx-handlers/handleMsgUpdatePermissions"
import { handleMsgUpdateUris } from "./tx-handlers/handleMsgUpdateUris"
import { flushCachedDocs } from "./db/cache"


const pollIntervalMs = 1_000
let outageTime: Date | undefined

const rpcs = JSON.parse(process.env.RPC_URLS || '["http://localhost:26657"]') as string[]

export const poll = async () => {
  try {
    // Connect to the chain client (this is first-time only)
    // This could be in init() but it is here in case indexer is started w/o the chain running
    if (!client) {
      for (let i = 0; i < rpcs.length; i++) {
        try {
          const newClient = await IndexerStargateClient.connect(rpcs[i])
          console.log("Connected to chain-id:", await newClient.getChainId())
          setClient(newClient)
          break;
        } catch (e) {
          console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`)
        }
      }

      throw new Error('Could not connect to any chain client')
    }

    // We fetch initial status at beginning of block and do not write anything in DB until end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
    const _status = await getStatus();
    const status = convertStatusDoc(_status, BigIntify);
    let docs: DocsCache = {
      accounts: {},
      collections: {},
      refreshes: {},
      activityToAdd: [],
      queueDocsToAdd: [],
      claims: {},
      balances: {},
    };

    const processing = status.block.height + 1n
    process.stdout.cursorTo(0);

    const block: Block = await client.getBlock(Number(processing))

    process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
    status.block.timestamp = BigInt(new Date(block.header.time).getTime());

    await handleBlock(block, status, docs)
    status.block.height++;
    status.block.txIndex = 0n;


    await fetchUrisFromQueue();
    await purgeQueueDocs();

    //Right now, we are banking on all these DB updates succeeding together every time. 
    //If there is a failure in the middle, it could be bad.
    await flushCachedDocs(docs, status);

    //Handle printing of status if there was an outage
    if (outageTime) {
      process.stdout.write('\n');
      console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`)
    }
    outageTime = undefined;
  } catch (e) {
    //Error handling

    //Attempt to reconnect to chain client
    try {
      outageTime = outageTime || new Date();
      for (let i = 0; i < rpcs.length; i++) {
        try {
          const newClient = await IndexerStargateClient.connect(rpcs[i])
          console.log("Connected to chain-id:", await newClient.getChainId())
          setClient(newClient)
          break;
        } catch (e) {
          console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`)
        }
      }

      process.stdout.write('\n');
    } catch (e) {
      process.stdout.cursorTo(0);
      process.stdout.clearLine(1);
      process.stdout.write(`Error connecting to chain client. ${outageTime ? `Outage Time: ${outageTime.toISOString()}` : ''} Retrying....`)
    }

    //Log error to DB, unless it is a connection refused error
    if (e.code !== 'ECONNREFUSED') {
      console.log(e);
      await ERRORS_DB.bulk({
        docs: [{
          _id: `${Date.now()}`,
          error: e,
        }]
      });
    }
  }

  const newTimer = setTimeout(poll, pollIntervalMs)
  setTimer(newTimer);
}



const handleBlock = async (block: Block, status: StatusDoc<bigint>, docs: DocsCache) => {
  if (0 < block.txs.length) console.log("")

  //Handle each tx consecutively
  while (status.block.txIndex < block.txs.length) {
    const txHash: string = toHex(sha256(block.txs[Number(status.block.txIndex)])).toUpperCase()
    const indexed: IndexedTx | null = await client.getTx(txHash);
    if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
    await handleTx(indexed, status, docs)
    status.block.txIndex++
  }
}

const handleTx = async (indexed: IndexedTx, status: StatusDoc<bigint>, docs: DocsCache) => {
  let decodedTx: DecodedTxRaw;
  try {
    JSON.parse(indexed.rawLog)

    if (indexed.code) {
      throw new Error(`Non-zero error code for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
    }
  } catch (e) {
    console.log(`Error parsing rawLog for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
  }

  decodedTx = decodeTxRaw(indexed.tx);

  // Calculate average gas price over last 1000 txs
  // Note: This is rough and not exact because we are rounding
  const NUM_TXS_TO_AVERAGE = 1000;
  if (decodedTx.authInfo.fee) {
    const gasLimit = decodedTx.authInfo.fee.gasLimit;

    for (const coin of decodedTx.authInfo.fee.amount) {
      const feeAmount = coin.amount;
      const feeDenom = coin.denom;

      if (feeDenom === "badge") {
        const gasPrice = BigInt(feeAmount) / BigInt(gasLimit.toString());

        status.lastXGasPrices.push(gasPrice);
        if (status.lastXGasPrices.length > NUM_TXS_TO_AVERAGE) {
          status.lastXGasPrices.shift();
        }

        status.gasPrice = status.lastXGasPrices.reduce((a, b) => a + b, 0n) / BigInt(status.lastXGasPrices.length);
      }
    }
  }


  for (const message of decodedTx.body.messages) {
    const typeUrl = message.typeUrl;
    const value = message.value;

    switch (typeUrl) {
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateUris":
        const urisMsg = convertFromProtoToMsgUpdateUris(tx.bitbadges.bitbadgeschain.badges.MsgUpdateUris.deserialize(value));
        await handleMsgUpdateUris(urisMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdatePermissions":
        const permissionsMsg = convertFromProtoToMsgUpdatePermissions(tx.bitbadges.bitbadgeschain.badges.MsgUpdatePermissions.deserialize(value));
        await handleMsgUpdatePermissions(permissionsMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateAllowedTransfers":
        const allowedMsg = convertFromProtoToMsgUpdateAllowedTransfers(tx.bitbadges.bitbadgeschain.badges.MsgUpdateAllowedTransfers.deserialize(value))
        await handleMsgUpdateAllowedTransfers(allowedMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateBytes":
        const bytesMsg = convertFromProtoToMsgUpdateBytes(tx.bitbadges.bitbadgeschain.badges.MsgUpdateBytes.deserialize(value))
        await handleMsgUpdateBytes(bytesMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgTransferManager":
        const transferManagerMsg = convertFromProtoToMsgTransferManager(tx.bitbadges.bitbadgeschain.badges.MsgTransferManager.deserialize(value))
        await handleMsgTransferManager(transferManagerMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgSetApproval":
        const setApprovalMsg = convertFromProtoToMsgSetApproval(tx.bitbadges.bitbadgeschain.badges.MsgSetApproval.deserialize(value))
        await handleMsgSetApproval(setApprovalMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgRequestTransferManager":
        const requestTransferManagerMsg = convertFromProtoToMsgRequestTransferManager(tx.bitbadges.bitbadgeschain.badges.MsgRequestTransferManager.deserialize(value))
        await handleMsgRequestTransferManager(requestTransferManagerMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgClaimBadge":
        const claimMsg = convertFromProtoToMsgClaimBadge(tx.bitbadges.bitbadgeschain.badges.MsgClaimBadge.deserialize(value))
        await handleMsgClaimBadge(claimMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgTransferBadge":
        const transferMsg = convertFromProtoToMsgTransferBadge(tx.bitbadges.bitbadgeschain.badges.MsgTransferBadge.deserialize(value))
        await handleMsgTransferBadge(transferMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgNewCollection":
        const newCollectionMsg = convertFromProtoToMsgNewCollection(tx.bitbadges.bitbadgeschain.badges.MsgNewCollection.deserialize(value))
        await handleMsgNewCollection(newCollectionMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgMintAndDistributeBadges":
        const newMintMsg = convertFromProtoToMsgMintAndDistributeBadges(tx.bitbadges.bitbadgeschain.badges.MsgMintAndDistributeBadges.deserialize(value))
        await handleMsgMintAndDistributeBadges(newMintMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgDeleteCollection":
        const newDeleteMsg = convertFromProtoToMsgDeleteCollection(tx.bitbadges.bitbadgeschain.badges.MsgDeleteCollection.deserialize(value))
        await handleMsgDeleteCollection(newDeleteMsg, status, docs);
        break;
      default:
        break;
    }
  }
}