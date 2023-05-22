import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { DecodedTxRaw, decodeTxRaw } from "@cosmjs/proto-signing"
import { Block, IndexedTx } from "@cosmjs/stargate"
import * as tx from 'bitbadgesjs-proto/dist/proto/badges/tx'
import { MessageMsgClaimBadge, MessageMsgDeleteCollection, MessageMsgMintAndDistributeBadges, MessageMsgNewCollection, MessageMsgRequestTransferManager, MessageMsgSetApproval, MessageMsgTransferBadge, MessageMsgTransferManager, MessageMsgUpdateAllowedTransfers, MessageMsgUpdateBytes, MessageMsgUpdatePermissions, MessageMsgUpdateUris, convertFromProtoToMessageMsgSetApproval, convertFromProtoToMsgClaimBadge, convertFromProtoToMsgDeleteCollection, convertFromProtoToMsgMintAndDistributeBadges, convertFromProtoToMsgNewCollection, convertFromProtoToMsgRequestTransferManager, convertFromProtoToMsgTransferBadge, convertFromProtoToMsgTransferManager, convertFromProtoToMsgUpdateAllowedTransfers, convertFromProtoToMsgUpdateBytes, convertFromProtoToMsgUpdatePermissions, convertFromProtoToMsgUpdateUris } from 'bitbadgesjs-transactions'
import { DbStatus, DocsCache } from "bitbadgesjs-utils"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ERRORS_DB, flushCachedDocs } from "./db/db"
import { getStatus } from "./db/status"
import { client, refreshQueueMutex, setClient, setTimer } from "./indexer"
import { fetchUriInQueue } from "./metadata-queue"
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


const pollIntervalMs = 1_000
let outageTime: Date | undefined

export const poll = async () => {
  try {
    // Connect to the chain client (this is first-time only)
    // This could be in init() but it is here in case indexer is started w/o the chain running
    if (!client) {
      const newClient = await IndexerStargateClient.connect(process.env.RPC_URL)
      console.log("Connected to chain-id:", await newClient.getChainId())
      setClient(newClient)
    }

    // We fetch initial status at beginning of block and do not write anything in DB until end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block

    await refreshQueueMutex.runExclusive(async () => {
      const status = await getStatus();
      let docs: DocsCache = {
        accounts: {},
        collections: {},
        metadata: {},
        activityToAdd: [],
        claims: {},
        balances: {},
      };

      const processing = status.block.height + 1n
      process.stdout.cursorTo(0);

      const block: Block = await client.getBlock(Number(processing))
      process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
      await handleBlock(block, status, docs)
      status.block.height++;


      await fetchUriInQueue(status, docs);

      //Right now, we are banking on all these DB updates succeeding together every time. 
      //If there is a failure in the middle, it could be bad.
      await flushCachedDocs(docs, status);


      //Handle printing of status if there was an outage
      if (outageTime) {
        process.stdout.write('\n');
        console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`)
      }
      outageTime = undefined;
    });
  } catch (e) {
    //Error handling

    //Attempt to reconnect to chain client
    try {
      outageTime = outageTime || new Date();
      const newClient = await IndexerStargateClient.connect(process.env.RPC_URL)
      setClient(newClient)
      process.stdout.write('\n');
      console.log("Connected to chain-id:", await newClient.getChainId())
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



const handleBlock = async (block: Block, status: DbStatus, docs: DocsCache) => {
  if (0 < block.txs.length) console.log("")

  //Handle each tx consecutively
  let txIndex = 0
  while (txIndex < block.txs.length) {
    const txHash: string = toHex(sha256(block.txs[txIndex])).toUpperCase()
    const indexed: IndexedTx | null = await client.getTx(txHash);
    if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
    await handleTx(indexed, status, docs)
    txIndex++
  }
}

const handleTx = async (indexed: IndexedTx, status: DbStatus, docs: DocsCache) => {
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
        const urisMsg: MessageMsgUpdateUris = convertFromProtoToMsgUpdateUris(tx.bitbadges.bitbadgeschain.badges.MsgUpdateUris.deserialize(value)) as MessageMsgUpdateUris;
        await handleMsgUpdateUris(urisMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdatePermissions":
        const permissionsMsg: MessageMsgUpdatePermissions = convertFromProtoToMsgUpdatePermissions(tx.bitbadges.bitbadgeschain.badges.MsgUpdatePermissions.deserialize(value)) as MessageMsgUpdatePermissions;
        await handleMsgUpdatePermissions(permissionsMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateAllowedTransfers":
        const allowedMsg: MessageMsgUpdateAllowedTransfers = convertFromProtoToMsgUpdateAllowedTransfers(tx.bitbadges.bitbadgeschain.badges.MsgUpdateAllowedTransfers.deserialize(value)) as MessageMsgUpdateAllowedTransfers;
        await handleMsgUpdateAllowedTransfers(allowedMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateBytes":
        const bytesMsg: MessageMsgUpdateBytes = convertFromProtoToMsgUpdateBytes(tx.bitbadges.bitbadgeschain.badges.MsgUpdateBytes.deserialize(value)) as MessageMsgUpdateBytes;
        await handleMsgUpdateBytes(bytesMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgTransferManager":
        const transferManagerMsg: MessageMsgTransferManager = convertFromProtoToMsgTransferManager(tx.bitbadges.bitbadgeschain.badges.MsgTransferManager.deserialize(value)) as MessageMsgTransferManager;
        await handleMsgTransferManager(transferManagerMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgSetApproval":
        const setApprovalMsg: MessageMsgSetApproval = convertFromProtoToMessageMsgSetApproval(tx.bitbadges.bitbadgeschain.badges.MsgSetApproval.deserialize(value)) as MessageMsgSetApproval;
        await handleMsgSetApproval(setApprovalMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgRequestTransferManager":
        const requestTransferManagerMsg: MessageMsgRequestTransferManager = convertFromProtoToMsgRequestTransferManager(tx.bitbadges.bitbadgeschain.badges.MsgRequestTransferManager.deserialize(value)) as MessageMsgRequestTransferManager;
        await handleMsgRequestTransferManager(requestTransferManagerMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgClaimBadge":
        const claimMsg: MessageMsgClaimBadge = convertFromProtoToMsgClaimBadge(tx.bitbadges.bitbadgeschain.badges.MsgClaimBadge.deserialize(value)) as MessageMsgClaimBadge;
        await handleMsgClaimBadge(claimMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgTransferBadge":
        const transferMsg: MessageMsgTransferBadge = convertFromProtoToMsgTransferBadge(tx.bitbadges.bitbadgeschain.badges.MsgTransferBadge.deserialize(value)) as MessageMsgTransferBadge;
        await handleMsgTransferBadge(transferMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgNewCollection":
        const newCollectionMsg: MessageMsgNewCollection = convertFromProtoToMsgNewCollection(tx.bitbadges.bitbadgeschain.badges.MsgNewCollection.deserialize(value)) as MessageMsgNewCollection;
        await handleMsgNewCollection(newCollectionMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgMintAndDistributeBadges":
        const newMintMsg: MessageMsgMintAndDistributeBadges = convertFromProtoToMsgMintAndDistributeBadges(tx.bitbadges.bitbadgeschain.badges.MsgMintAndDistributeBadges.deserialize(value)) as MessageMsgMintAndDistributeBadges;
        await handleMsgMintAndDistributeBadges(newMintMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgDeleteCollection":
        const newDeleteMsg: MessageMsgDeleteCollection = convertFromProtoToMsgDeleteCollection(tx.bitbadges.bitbadgeschain.badges.MsgDeleteCollection.deserialize(value)) as MessageMsgDeleteCollection;
        await handleMsgDeleteCollection(newDeleteMsg, status, docs);
        break;
      default:
        break;
    }
  }
}