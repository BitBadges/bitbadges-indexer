import { sha256 } from "@cosmjs/crypto"
import { toHex } from "@cosmjs/encoding"
import { DecodedTxRaw, decodeTxRaw } from "@cosmjs/proto-signing"
import { Block, IndexedTx } from "@cosmjs/stargate"
import { Balance, JSPrimitiveNumberType, Transfer, convertBalance, convertFromProtoToMsgCreateAddressMappings, convertFromProtoToMsgCreateCollection, convertFromProtoToMsgDeleteCollection, convertFromProtoToMsgTransferBadges, convertFromProtoToMsgUniversalUpdateCollection, convertFromProtoToMsgUpdateCollection, convertFromProtoToMsgUpdateUserApprovals, convertTransfer } from "bitbadgesjs-proto"
import * as tx from 'bitbadgesjs-proto/dist/proto/badges/tx_pb'
import * as bank from 'bitbadgesjs-proto/dist/proto/cosmos/bank/v1beta1/tx_pb'
import * as solana from 'bitbadgesjs-proto/dist/proto/solana/web3_pb'
import * as protocoltx from 'bitbadgesjs-proto/dist/proto/protocols/tx_pb'
import { BigIntify, CollectionDoc, ComplianceDoc, DocsCache, StatusDoc, convertComplianceDoc, convertStatusDoc, convertToCosmosAddress } from "bitbadgesjs-utils"
import { Attribute, StringEvent } from "cosmjs-types/cosmos/base/abci/v1beta1/abci"
import mongoose from "mongoose"
import { serializeError } from "serialize-error"
import { IndexerStargateClient } from "./chain-client/indexer_stargateclient"
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from "./db/cache"
import { ComplianceModel, ErrorModel, MongoDB, ProtocolModel, StatusModel, deleteMany, insertMany, mustGetFromDB } from "./db/db"
import { getStatus } from "./db/status"
import { SHUTDOWN, client, setClient, setTimer, setUriPollerTimer } from "./indexer"
import { TIME_MODE } from "./indexer-vars"
import { handleQueueItems } from "./queue"
import { handleMsgCreateAddressMappings } from "./tx-handlers/handleMsgCreateAddressMappings"
import { handleMsgCreateCollection } from "./tx-handlers/handleMsgCreateCollection"
import { handleMsgDeleteCollection } from "./tx-handlers/handleMsgDeleteCollection"
import { handleMsgTransferBadges } from "./tx-handlers/handleMsgTransferBadges"
import { handleMsgUniversalUpdateCollection } from "./tx-handlers/handleMsgUniversalUpdateCollection"
import { handleMsgUpdateCollection } from "./tx-handlers/handleMsgUpdateCollection"
import { handleMsgUpdateUserApprovals } from "./tx-handlers/handleMsgUpdateUserApprovals"
import { handleNewAccountByAddress } from "./tx-handlers/handleNewAccount"
import { handleTransfers } from "./tx-handlers/handleTransfers"

const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS) || 1_000
const uriPollIntervalMs = Number(process.env.URI_POLL_INTERVAL_MS) || 1_000

let outageTime: Date | undefined

const rpcs = JSON.parse(process.env.RPC_URLS || '["http://localhost:26657"]') as string[]
let currRpcIdx = -1;

export async function connectToRpc() {
  //If we have a currClient,, move that to the end of the rpcs array. It failed so we try it last
  if (currRpcIdx > -1) {
    const currRpc = rpcs.splice(currRpcIdx, 1)[0];
    rpcs.push(currRpc);
  }

  for (let i = 0; i < rpcs.length; i++) {
    try {
      const newClient = await IndexerStargateClient.connect(rpcs[i])
      console.log("Connected to chain-id:", await newClient.getChainId())
      setClient(newClient)
      currRpcIdx = i;
      break;
    } catch (e) {
      console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`)
    }
  }


  if (!client) throw new Error('Could not connect to any chain client')
}

export const QUEUE_TIME_MODE = process.env.QUEUE_TIME_MODE == 'true';

export const pollUris = async () => {
  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.time("pollUris");
  }
  try {
    // We fetch initial status at beginning of block and do not write anything in DB until end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
    const _status = await getStatus();
    const status = convertStatusDoc(_status, BigIntify);
    await handleQueueItems(status.block.height);
  } catch (e) {
    //Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [{
        _legacyId: new mongoose.Types.ObjectId().toString(),
        error: serializeError(e),
        function: 'pollUris',
      }]);
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.timeEnd("pollUris");
  }

  if (SHUTDOWN) return;

  const newTimer = setTimeout(pollUris, uriPollIntervalMs);
  setUriPollerTimer(newTimer);
}

export let complianceDoc: ComplianceDoc<bigint> | undefined = undefined;

export const poll = async () => {
  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.time("poll");
  }

  try {

    // Connect to the chain client (this is first-time only)
    // This could be in init() but it is here in case indexer is started w/o the chain running
    if (!client) {
      await connectToRpc();
    }

    // const _status = await getStatus();
    // let status = convertStatusDoc(_status, BigIntify);
    const clientHeight = await client.getHeight();
    let caughtUp = false;
    // let fastCatchUp = false;

    // We fetch initial status at beginning of block and do not write anything in DB until flush at end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
    // If we are behind, go until we catch up


    const _status = await getStatus();

    let status = convertStatusDoc(_status, BigIntify);

    //Every 50 blocks, query the compliance doc to be used
    if (status.block.height % 50n == 0n || !complianceDoc) {
      const _complianceDoc = await mustGetFromDB(ComplianceModel, 'compliance')
      complianceDoc = convertComplianceDoc(_complianceDoc, BigIntify);
    }

    while (!caughtUp) {
      // We fetch initial status at beginning of block and do not write anything in DB until flush at end of block
      // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block

      if (status.block.height >= clientHeight) {
        caughtUp = true;
        break;
      }



      let docs: DocsCache = {
        accounts: {},
        collections: {},
        refreshes: {},
        activityToAdd: [],
        claimAlertsToAdd: [],
        queueDocsToAdd: [],
        merkleChallenges: {},
        addressMappings: {},
        approvalsTrackers: {},
        balances: {},
        passwordDocs: {},
        protocols: {},
        userProtocolCollections: {},
      };

      const session = await MongoDB.startSession();
      session.startTransaction();
      try {


        //Handle printing of status if there was an outage
        if (outageTime) {
          if (!TIME_MODE) process.stdout.write('\n');
          console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`)
        }
        outageTime = undefined;

        const processing = status.block.height + 1n;
        if (!TIME_MODE) process.stdout.cursorTo(0);

        const block: Block = await client.getBlock(Number(processing))

        if (!TIME_MODE) process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`)
        status.block.timestamp = BigInt(new Date(block.header.time).getTime());

        await handleBlock(block, status, docs, session);

        status.block.height++;
        status.block.txIndex = 0n;


        //Right now, we are banking on all these DB updates succeeding together every time. 
        //If there is a failure in the middle, it could be bad.
        const flushed = await flushCachedDocs(docs, session, status, status.block.height < clientHeight);
        if (flushed) {
          const status2 = await StatusModel.findOne({}).lean().session(session).exec();
          status = convertStatusDoc(status2 as StatusDoc<JSPrimitiveNumberType>, BigIntify);
        }

        await session.commitTransaction();
        await session.endSession();
      } catch (e) {
        console.error(e);
        await session.abortTransaction();
        await session.endSession();
        throw e;
      }

    }
  } catch (e) {
    //Error handling
    //Attempt to reconnect to chain client
    if (e && e.code === 'ECONNREFUSED') {
      try {
        outageTime = outageTime || new Date();
        connectToRpc();

        if (!TIME_MODE) process.stdout.write('\n');
      } catch (e) {
        if (!TIME_MODE) process.stdout.cursorTo(0);
        if (!TIME_MODE) process.stdout.clearLine(1);
        if (!TIME_MODE) process.stdout.write(`Error connecting to chain client. ${outageTime ? `Outage Time: ${outageTime.toISOString()}` : ''} Retrying....`)
      }
    }

    //Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [{
        _legacyId: new mongoose.Types.ObjectId().toString(),
        error: serializeError(e),
        function: 'poll',
      }]);
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.timeEnd("poll");
  }
  if (SHUTDOWN) return;

  const newTimer = setTimeout(poll, pollIntervalMs)
  setTimer(newTimer);
}

const handleEvents = async (events: StringEvent[], status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  try {
    let eventIndex = 0
    while (eventIndex < events.length) {
      await handleEvent(events[eventIndex], status, docs, txHash)
      eventIndex++
    }
  } catch (e) {
    // Skipping if the handling failed. Most likely the transaction failed.
  }
}


//TODO: Do this natively via Msgs instead of events?
const handleEvent = async (event: StringEvent, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {

  if (getAttributeValueByKey(event.attributes, "amountTrackerId")) {
    const amountTrackerId = getAttributeValueByKey(event.attributes, "amountTrackerId") ?? '';
    const approverAddress = getAttributeValueByKey(event.attributes, "approverAddress") ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, "collectionId") ?? '';
    const approvalLevel = getAttributeValueByKey(event.attributes, "approvalLevel") as "collection" | "incoming" | "outgoing" | "" | undefined ?? '';
    const trackerType = getAttributeValueByKey(event.attributes, "trackerType") ?? '';
    const approvedAddress = getAttributeValueByKey(event.attributes, "approvedAddress") ?? '';
    const amountsJsonStr = getAttributeValueByKey(event.attributes, "amounts") ?? '';
    const numTransfersJsonStr = getAttributeValueByKey(event.attributes, "numTransfers") ?? '';

    const docId = `${collectionId}:${approvalLevel}-${approverAddress}-${amountTrackerId}-${trackerType}-${approvedAddress}`;
    const amounts = JSON.parse(amountsJsonStr && amountsJsonStr != "null" ? amountsJsonStr : '[]') as Balance<string>[];
    const numTransfers = numTransfersJsonStr && numTransfersJsonStr != "null" ? BigIntify(JSON.parse(numTransfersJsonStr)) : 0n;

    docs.approvalsTrackers[docId] = {
      _legacyId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      approvalLevel: approvalLevel ? approvalLevel : '',
      approverAddress: approverAddress ? approverAddress : '',
      amountTrackerId: amountTrackerId ? amountTrackerId : '',
      trackerType: trackerType as "overall" | "to" | "from" | "initiatedBy",
      approvedAddress: approvedAddress ? approvedAddress : '',
      numTransfers: BigInt(numTransfers),
      amounts: amounts.map(x => convertBalance(x, BigIntify)),
    }
  }

  if (getAttributeValueByKey(event.attributes, "challengeId")) {
    const challengeId = getAttributeValueByKey(event.attributes, "challengeId") ?? '';
    const approverAddress = getAttributeValueByKey(event.attributes, "approverAddress") ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, "collectionId") ?? '';
    const challengeLevel = getAttributeValueByKey(event.attributes, "challengeLevel") as "collection" | "incoming" | "outgoing" | "" | undefined ?? '';
    const leafIndex = getAttributeValueByKey(event.attributes, "leafIndex") ?? '';

    const docId = `${collectionId}:${challengeLevel}-${approverAddress}-${challengeId}`;
    const currDoc = docs.merkleChallenges[docId];
    const newLeafIndices = currDoc ? currDoc.usedLeafIndices : [];
    newLeafIndices.push(BigIntify(leafIndex ? leafIndex : 0n));

    docs.merkleChallenges[docId] = {
      _legacyId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      challengeId: challengeId ? challengeId : '',
      challengeLevel: challengeLevel ? challengeLevel : '' as "collection" | "incoming" | "outgoing" | "",
      approverAddress: approverAddress ? approverAddress : '',
      usedLeafIndices: newLeafIndices,
    }
  }

  if (getAttributeValueByKey(event.attributes, "transfer")) {
    const creator = getAttributeValueByKey(event.attributes, "creator") as string;

    const _transfer = JSON.parse(getAttributeValueByKey(event.attributes, "transfer") as string) as Transfer<string>;
    const transfer = convertTransfer(_transfer, BigIntify);
    const collectionId = getAttributeValueByKey(event.attributes, "collectionId");
    if (!collectionId || !transfer) throw new Error(`Missing collectionId or transfer in event: ${JSON.stringify(event)}`)

    await fetchDocsForCacheIfEmpty(docs, [], [BigInt(collectionId)], [], [], [], [], [], [], []);
    await handleTransfers(docs.collections[collectionId] as CollectionDoc<bigint>, [transfer], docs, status, creator, txHash, true);
  }
}

const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value
}

const handleBlock = async (block: Block, status: StatusDoc<bigint>, docs: DocsCache, session: mongoose.ClientSession) => {
  if (0 < block.txs.length && !TIME_MODE) console.log("")

  //Handle each tx consecutively
  while (status.block.txIndex < block.txs.length) {
    const txHash: string = toHex(sha256(block.txs[Number(status.block.txIndex)])).toUpperCase()
    const indexed: IndexedTx | null = await client.getTx(txHash);
    if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`)
    await handleTx(indexed, status, docs, session)
    status.block.txIndex++
  }

  // We currently don't read any end blockers (only tx events)
  // const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
  // if (0 < events.length) console.log("HAS EVENTS")
  // await handleEvents(events, status, docs)
}

const handleTx = async (indexed: IndexedTx, status: StatusDoc<bigint>, docs: DocsCache, session: mongoose.ClientSession) => {
  let decodedTx: DecodedTxRaw;
  try {
    try {
      JSON.parse(indexed.rawLog)
    } catch (e) {
      console.error(indexed.rawLog);
      throw new Error(`Error parsing rawLog for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
    }
    if (indexed.code) {
      throw new Error(`Non-zero error code for tx ${indexed.hash}. Skipping tx as it most likely failed...`)
    }
  } catch (e) {
    console.log(e);
    return;
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
        status.lastXGasAmounts.push(BigInt(feeAmount));
        status.lastXGasLimits.push(BigInt(gasLimit.toString()));

        if (status.lastXGasAmounts.length > NUM_TXS_TO_AVERAGE) {
          status.lastXGasAmounts.shift();
          status.lastXGasLimits.shift();
        }

        status.gasPrice = Number(status.lastXGasAmounts.reduce((a, b) => a + b, 0n)) / Number(status.lastXGasLimits.reduce((a, b) => a + b, 0n));
      }
    }
  }


  for (const extensionOption of decodedTx.body.extensionOptions) {
    const typeUrl = extensionOption.typeUrl;
    const val = extensionOption.value;

    if (typeUrl === '/solana.ExtensionOptionsWeb3TxSolana') {
      const web3Tx = solana.ExtensionOptionsWeb3TxSolana.fromBinary(val);
      const solAddress = web3Tx.solAddress;
      if (solAddress) {
        const cosmosAddress = convertToCosmosAddress(solAddress);
        if (cosmosAddress) await handleNewAccountByAddress(cosmosAddress, docs, solAddress);
      }
    }
  }

  // let messageIdx = 0;
  for (const message of decodedTx.body.messages) {
    const typeUrl = message.typeUrl;
    const value = message.value;


    switch (typeUrl) {
      case "/protocols.MsgCreateProtocol":

        const newProtocolMsg = protocoltx.MsgCreateProtocol.fromBinary(value)

        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [],  [newProtocolMsg.name], []);

        docs.protocols[newProtocolMsg.name] = {
          _legacyId: newProtocolMsg.name,
          ...newProtocolMsg,
          createdBy: newProtocolMsg.creator,
        }
        break;
      case "/protocols.MsgUpdateProtocol":
        const updateProtocolMsg = protocoltx.MsgUpdateProtocol.fromBinary(value)
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [updateProtocolMsg.name], []);
        docs.protocols[updateProtocolMsg.name] = {
          ...docs.protocols[updateProtocolMsg.name],
          _legacyId: updateProtocolMsg.name,
          
          createdBy: updateProtocolMsg.creator,
          ...updateProtocolMsg,
        }
        break;
      case "/protocols.MsgDeleteProtocol":
        const deleteProtocolMsg = protocoltx.MsgDeleteProtocol.fromBinary(value)
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [deleteProtocolMsg.name], []);
        delete docs.protocols[deleteProtocolMsg.name];
        await deleteMany(ProtocolModel, [deleteProtocolMsg.name], session);
        break;
      case "/protocols.MsgSetCollectionForProtocol":
        const setCollectionForProtocolMsg = protocoltx.MsgSetCollectionForProtocol.fromBinary(value)

        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [], [setCollectionForProtocolMsg.creator]);

        let collectionIdToSet = setCollectionForProtocolMsg.collectionId;
        if (BigInt(setCollectionForProtocolMsg.collectionId) == 0n) {
          const prevCollectionId = status.nextCollectionId - 1n;
          collectionIdToSet = prevCollectionId.toString();
        }

        docs.userProtocolCollections[setCollectionForProtocolMsg.creator] = {
          _legacyId: setCollectionForProtocolMsg.creator,
          protocols: {
            ...docs.userProtocolCollections[setCollectionForProtocolMsg.creator]?.protocols,
            [setCollectionForProtocolMsg.name]: BigInt(collectionIdToSet),
          }
        }
        break;
      case "/protocols.MsgUnsetCollectionForProtocol":
        const unsetCollectionForProtocolMsg = protocoltx.MsgUnsetCollectionForProtocol.fromBinary(value)
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [], [unsetCollectionForProtocolMsg.creator]);
        delete docs.userProtocolCollections[unsetCollectionForProtocolMsg.creator]?.protocols[unsetCollectionForProtocolMsg.name];
        
        break;
      case "/badges.MsgTransferBadges":
        const transferMsg = convertFromProtoToMsgTransferBadges(tx.MsgTransferBadges.fromBinary(value))
        await handleMsgTransferBadges(transferMsg, status, docs, indexed.hash)
        break;
      case "/badges.MsgDeleteCollection":
        const newDeleteMsg = convertFromProtoToMsgDeleteCollection(tx.MsgDeleteCollection.fromBinary(value))
        await handleMsgDeleteCollection(newDeleteMsg, status, docs, session);
        break;
      case "/badges.MsgCreateAddressMappings":
        const newAddressMappingsMsg = convertFromProtoToMsgCreateAddressMappings(tx.MsgCreateAddressMappings.fromBinary(value))
        await handleMsgCreateAddressMappings(newAddressMappingsMsg, status, docs, indexed.hash);
        //Don't need to track, we have created at and address mappings on-chain are permanent and immutable
        // msg = newAddressMappingsMsg;
        break;
      case "/badges.MsgUniversalUpdateCollection":
        const newUpdateCollectionMsg = convertFromProtoToMsgUniversalUpdateCollection(tx.MsgUniversalUpdateCollection.fromBinary(value))
        await handleMsgUniversalUpdateCollection(newUpdateCollectionMsg, status, docs, indexed.hash)
        break;
      case "/badges.MsgCreateCollection":
        const newCreateMsg = convertFromProtoToMsgCreateCollection(tx.MsgCreateCollection.fromBinary(value))
        await handleMsgCreateCollection(newCreateMsg, status, docs, indexed.hash)
        break;
      case "/badges.MsgUpdateCollection":
        const newUpdateMsg = convertFromProtoToMsgUpdateCollection(tx.MsgUpdateCollection.fromBinary(value))
        await handleMsgUpdateCollection(newUpdateMsg, status, docs, indexed.hash)
        break;
      case "/badges.MsgUpdateUserApprovals":
        const newUpdateUserApprovalsMsg = convertFromProtoToMsgUpdateUserApprovals(tx.MsgUpdateUserApprovals.fromBinary(value))
        await handleMsgUpdateUserApprovals(newUpdateUserApprovalsMsg, status, docs, indexed.hash)
        break;
      case "/cosmos.bank.v1beta1.MsgSend":
        const newMsgSend = bank.MsgSend.fromBinary(value);
        const fromAddress = newMsgSend.fromAddress;
        const toAddress = newMsgSend.toAddress;
        if (fromAddress) await handleNewAccountByAddress(fromAddress, docs)
        if (toAddress) await handleNewAccountByAddress(toAddress, docs)
      // Don't need to track MsgSends
      // msg = newMsgSend;
      default:
        break;
    }
  }

  let rawLog;
  let events;

  // Try to parse the JSON and flatten the events
  try {
    rawLog = JSON.parse(indexed.rawLog);
    events = rawLog.flatMap((log: any) => log.events);

    // Try to handle the events
    if (events) {
      try {
        await handleEvents(events, status, docs, indexed.hash);
      } catch (e) {
        // Throw an error if handleEvents fails
        throw new Error(`handleEvents failed: ${e.message}`);
      }
    }
  } catch (e) {
    // Handle JSON parsing errors here if needed, or just continue
    console.error("JSON parsing failed. Skipping event as it most likely failed", e);



    await insertMany(ErrorModel, [{
      _legacyId: new mongoose.Types.ObjectId().toString(),
      error: serializeError(e),
      function: 'handleEvents' + ' - ' + indexed.hash,
    }]);
  }
}

