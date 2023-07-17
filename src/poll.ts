import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { DecodedTxRaw, decodeTxRaw } from "@cosmjs/proto-signing"
import { Block, IndexedTx } from "@cosmjs/stargate"
import { Balance, convertBalance, convertFromProtoToMsgDeleteCollection, convertFromProtoToMsgTransferBadges, convertFromProtoToMsgUpdateCollection, convertFromProtoToMsgUpdateUserApprovedTransfers } from "bitbadgesjs-proto"
import * as tx from 'bitbadgesjs-proto/dist/proto/badges/tx'
import { BigIntify, StatusDoc, DocsCache, convertStatusDoc } from "bitbadgesjs-utils"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { ERRORS_DB } from "./db/db"
import { getStatus } from "./db/status"
import { client, setClient, setTimer } from "./indexer"
import { fetchUrisFromQueue, purgeQueueDocs } from "./metadata-queue"
import { handleMsgDeleteCollection } from "./tx-handlers/handleMsgDeleteCollection"
import { handleMsgTransferBadges } from "./tx-handlers/handleMsgTransferBadges"
import { handleMsgUpdateCollection } from "./tx-handlers/handleMsgUpdateCollection"
import { handleMsgUpdateUserApprovedTransfers } from "./tx-handlers/handleMsgUpdateUserApprovedTransfers"
import { handleMsgCreateAddressMappings } from "./tx-handlers/handleMsgCreateAddressMappings"
import { flushCachedDocs } from "./db/cache"
import { StringEvent, Attribute } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"


const pollIntervalMs = 1000
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

      if (!client) throw new Error('Could not connect to any chain client')
    }

    const clientHeight = await client.getHeight();
    let caughtUp = false;

    // If we are behind, go until we catch up
    do {

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
        merkleChallenges: {},
        addressMappings: {},
        approvalsTrackers: {},
        balances: {},
      };

      if (status.block.height >= clientHeight) {
        caughtUp = true;
        break;
      }

      //Handle printing of status if there was an outage
      if (outageTime) {
        process.stdout.write('\n');
        console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`)
      }
      outageTime = undefined;


      const processing = status.block.height + 1n;
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


    } while (!caughtUp);


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
    if (e && e.code !== 'ECONNREFUSED') {
      console.log(e);
      await ERRORS_DB.bulk({
        docs: [{
          error: e,
          function: 'poll',
        }]
      });
    }
  }

  const newTimer = setTimeout(poll, pollIntervalMs)
  setTimer(newTimer);
}

const handleEvents = async (events: StringEvent[], status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  try {
    let eventIndex = 0
    while (eventIndex < events.length) {
      await handleEvent(events[eventIndex], status, docs)
      eventIndex++
    }
  } catch (e) {
    // Skipping if the handling failed. Most likely the transaction failed.
  }
}


//TODO: Do this natively via Msgs instead of events
const handleEvent = async (event: StringEvent, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  if (getAttributeValueByKey(event.attributes, "approvalId")) {
    const approvalId = getAttributeValueByKey(event.attributes, "approvalId");
    const approverAddress = getAttributeValueByKey(event.attributes, "approverAddress");
    const collectionId = getAttributeValueByKey(event.attributes, "collectionId");
    const approvalLevel = getAttributeValueByKey(event.attributes, "approvalLevel") as "collection" | "incoming" | "outgoing" | "" | undefined;
    const trackerType = getAttributeValueByKey(event.attributes, "trackerType");
    const approvedAddress = getAttributeValueByKey(event.attributes, "approvedAddress");
    const amountsJsonStr = getAttributeValueByKey(event.attributes, "amounts");
    const numTransfersJsonStr = getAttributeValueByKey(event.attributes, "numTransfers");

    const docId = `${collectionId}:${approvalLevel}-${approverAddress}-${approvalId}-${trackerType}-${approvedAddress}`;
    const amounts = JSON.parse(amountsJsonStr ? amountsJsonStr : '[]') as Balance<string>[];
    const numTransfers = numTransfersJsonStr ? BigIntify(JSON.parse(numTransfersJsonStr)) : 0n;

    docs.approvalsTrackers[docId] = {
      _id: docId,
      _rev: '',
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      approvalLevel: approvalLevel ? approvalLevel : '',
      approverAddress: approverAddress ? approverAddress : '',
      approvalId: approvalId ? approvalId : '',
      trackerType: trackerType as "overall" | "to" | "from" | "initiatedBy",
      approvedAddress: approvedAddress ? approvedAddress : '',
      numTransfers: BigInt(numTransfers),
      amounts: amounts.map(x => convertBalance(x, BigIntify)),
    }
  }

  if (getAttributeValueByKey(event.attributes, "challengeId")) {
    const challengeId = getAttributeValueByKey(event.attributes, "challengeId");
    const approverAddress = getAttributeValueByKey(event.attributes, "approverAddress");
    const collectionId = getAttributeValueByKey(event.attributes, "collectionId");
    const challengeLevel = getAttributeValueByKey(event.attributes, "challengeLevel") as "collection" | "incoming" | "outgoing" | "" | undefined;
    const leafIndex = getAttributeValueByKey(event.attributes, "leafIndex");

    const docId = `${collectionId}:${challengeLevel}-${approverAddress}-${challengeId}`;
    const currDoc = docs.merkleChallenges[docId];
    const newLeafIndices = currDoc ? currDoc.usedLeafIndices : [];
    newLeafIndices.push(BigIntify(leafIndex ? leafIndex : 0n));

    docs.merkleChallenges[docId] = {
      _id: docId,
      _rev: '',
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      challengeId: challengeId ? challengeId : '',
      challengeLevel: challengeLevel ? challengeLevel : '' as "collection" | "incoming" | "outgoing" | "",
      approverAddress: approverAddress ? approverAddress : '',
      usedLeafIndices: newLeafIndices,
    }
  }
}

const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value
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

  const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
  if (0 < events.length) console.log("")
  await handleEvents(events, status, docs)
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
      case "/bitbadges.bitbadgeschain.badges.MsgTransferBadges":
        const transferMsg = convertFromProtoToMsgTransferBadges(tx.bitbadges.bitbadgeschain.badges.MsgTransferBadges.deserialize(value))
        await handleMsgTransferBadges(transferMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgDeleteCollection":
        const newDeleteMsg = convertFromProtoToMsgDeleteCollection(tx.bitbadges.bitbadgeschain.badges.MsgDeleteCollection.deserialize(value))
        await handleMsgDeleteCollection(newDeleteMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgCreateAddressMappings":
        const newAddressMappingsMsg = (tx.bitbadges.bitbadgeschain.badges.MsgCreateAddressMappings.deserialize(value))
        await handleMsgCreateAddressMappings(newAddressMappingsMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateCollection":
        const newUpdateCollectionMsg = convertFromProtoToMsgUpdateCollection(tx.bitbadges.bitbadgeschain.badges.MsgUpdateCollection.deserialize(value))
        await handleMsgUpdateCollection(newUpdateCollectionMsg, status, docs);
        break;
      case "/bitbadges.bitbadgeschain.badges.MsgUpdateUserApprovedTransfers":
        const newUpdateUserApprovedTransfersMsg = convertFromProtoToMsgUpdateUserApprovedTransfers(tx.bitbadges.bitbadgeschain.badges.MsgUpdateUserApprovedTransfers.deserialize(value))
        await handleMsgUpdateUserApprovedTransfers(newUpdateUserApprovedTransfersMsg, status, docs);
        break;
      default:
        break;
    }
  }
}