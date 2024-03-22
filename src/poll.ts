import { sha256 } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';
import { decodeTxRaw, type DecodedTxRaw } from '@cosmjs/proto-signing';
import { type Block, type IndexedTx } from '@cosmjs/stargate';
import sgMail from '@sendgrid/mail';
import {
  ApprovalTrackerDoc,
  BalanceArray,
  BigIntify,
  MerkleChallengeDoc,
  MsgCreateAddressLists,
  MsgCreateCollection,
  MsgDeleteCollection,
  MsgTransferBadges,
  MsgUniversalUpdateCollection,
  MsgUpdateCollection,
  MsgUpdateUserApprovals,
  ProtocolDoc,
  QueueDoc,
  Transfer,
  UserProtocolCollectionsDoc,
  convertToCosmosAddress,
  type iBalance,
  type ComplianceDoc,
  type StatusDoc,
  MerkleProof
} from 'bitbadgesjs-sdk';
import * as tx from 'bitbadgesjs-sdk/dist/proto/badges/tx_pb';
import * as bank from 'bitbadgesjs-sdk/dist/proto/cosmos/bank/v1beta1/tx_pb';
import * as protocoltx from 'bitbadgesjs-sdk/dist/proto/protocols/tx_pb';
import * as solana from 'bitbadgesjs-sdk/dist/proto/solana/web3_pb';
import { type Attribute, type StringEvent } from 'cosmjs-types/cosmos/base/abci/v1beta1/abci';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { IndexerStargateClient } from './chain-client/indexer_stargateclient';
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from './db/cache';
import { MongoDB, deleteMany, getFromDB, insertMany, insertToDB, mustGetFromDB } from './db/db';
import {
  ClaimAlertModel,
  ComplianceModel,
  ErrorModel,
  ListActivityModel,
  ProfileModel,
  ProtocolModel,
  QueueModel,
  StatusModel,
  TransferActivityModel
} from './db/schemas';
import { getStatus } from './db/status';
import { type DocsCache } from './db/types';
import { SHUTDOWN, client, setClient, setNotificationPollerTimer, setTimer, setUriPollerTimer } from './indexer';
import { TIME_MODE } from './indexer-vars';
import { handleQueueItems } from './queue';
import { initializeFollowProtocol, unsetFollowCollection } from './routes/follows';
import { handleMsgCreateAddressLists } from './tx-handlers/handleMsgCreateAddressLists';
import { handleMsgCreateCollection } from './tx-handlers/handleMsgCreateCollection';
import { handleMsgDeleteCollection } from './tx-handlers/handleMsgDeleteCollection';
import { handleMsgTransferBadges } from './tx-handlers/handleMsgTransferBadges';
import { handleMsgUniversalUpdateCollection } from './tx-handlers/handleMsgUniversalUpdateCollection';
import { handleMsgUpdateCollection } from './tx-handlers/handleMsgUpdateCollection';
import { handleMsgUpdateUserApprovals } from './tx-handlers/handleMsgUpdateUserApprovals';
import { handleNewAccountByAddress } from './tx-handlers/handleNewAccount';
import { handleTransfers } from './tx-handlers/handleTransfers';
import { findInDB } from './db/queries';

const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS) || 1_000;
const uriPollIntervalMs = Number(process.env.URI_POLL_INTERVAL_MS) || 1_000;
const notificationPollIntervalMs = Number(process.env.NOTIFICATION_POLL_INTERVAL_MS) || 1_000;

let outageTime: Date | undefined;

const rpcs = JSON.parse(process.env.RPC_URLS ?? '["http://localhost:26657"]') as string[];
let currRpcIdx = -1;

export async function connectToRpc() {
  // If we have a currClient,, move that to the end of the rpcs array. It failed so we try it last
  if (currRpcIdx > -1) {
    const currRpc = rpcs.splice(currRpcIdx, 1)[0];
    rpcs.push(currRpc);
  }

  for (let i = 0; i < rpcs.length; i++) {
    try {
      const newClient = await IndexerStargateClient.connect(rpcs[i]);
      console.log('Connected to chain-id:', await newClient.getChainId());
      setClient(newClient);
      currRpcIdx = i;
      break;
    } catch (e) {
      console.log(e);
      console.log(`Error connecting to chain client at ${rpcs[i]}. Trying new one....`);
    }
  }

  if (!client) throw new Error('Could not connect to any chain client');
}

export const QUEUE_TIME_MODE = process.env.QUEUE_TIME_MODE === 'true';

export const pollUris = async () => {
  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.time('pollUris');
  }
  try {
    // We fetch initial status at beginning of block and do not write anything in DB until end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
    const status = await getStatus();
    await handleQueueItems(status.block.height);
  } catch (e) {
    // Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [
        {
          _docId: new mongoose.Types.ObjectId().toString(),
          error: serializeError(e),
          function: 'pollUris'
        }
      ]);
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.timeEnd('pollUris');
  }

  if (SHUTDOWN) return;
  const newTimer = setTimeout(pollUris, uriPollIntervalMs);
  setUriPollerTimer(newTimer);
};

enum NotificationType {
  TransferActivity = 'transfer',
  List = 'list',
  ClaimAlert = 'claimAlert'
}

const BETANET = true;
export async function sendPushNotification(address: string, type: string, message: string, docId: string, queueDoc?: QueueDoc<bigint>) {
  try {
    const profile = await getFromDB(ProfileModel, address);
    if (!profile) return;

    if (!profile.notifications?.email) return;
    if (!profile.notifications?.emailVerification?.verified) return;
    if (BETANET) return;
    // const antiPhishingCode = profile.notifications.emailVerification.antiPhishingCode;

    let subject = '';
    switch (type) {
      case NotificationType.TransferActivity:
        subject = 'You have received badges';
        break;
      case NotificationType.List:
        subject = 'You have been added to a list';
        break;
      case NotificationType.ClaimAlert:
        subject = 'You are able to claim BitBadges';
        break;
    }

    const toReceiveListActivity = profile.notifications.preferences?.listActivity;
    const toReceiveTransferActivity = profile.notifications.preferences?.transferActivity;
    const toReceiveClaimAlerts = profile.notifications.preferences?.claimAlerts;

    if (type === NotificationType.List && !toReceiveListActivity) return;
    if (type === NotificationType.TransferActivity && !toReceiveTransferActivity) return;
    if (type === NotificationType.ClaimAlert && !toReceiveClaimAlerts) return;

    const emails: Array<{
      to: string;
      from: string;
      subject: string;
      text: string;
    }> = [
      {
        to: profile.notifications.email,
        from: 'info@mail.bitbadges.io',
        subject,
        text: message
      }
    ];

    sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
    await sgMail.send(emails, true);
  } catch (e) {
    const queueObj = queueDoc ?? {
      _docId: crypto.randomBytes(16).toString('hex'),
      uri: '',
      collectionId: 0n,
      loadBalanceId: 0n,
      activityDocId: docId,
      refreshRequestTime: BigInt(Date.now()),
      numRetries: 0n,
      lastFetchedAt: BigInt(Date.now()),
      nextFetchTime: BigInt(Date.now() + 1000 * 60),
      emailMessage: message,
      recipientAddress: address,
      notificationType: type
    };

    const BASE_DELAY = process.env.BASE_DELAY ? Number(process.env.BASE_DELAY) : 1000 * 60 * 60 * 1; // 1 hour
    const delay = BASE_DELAY * Math.pow(2, Number(queueObj.numRetries + 1n));

    let reason = '';
    try {
      reason = e.toString();
    } catch (e) {
      try {
        reason = JSON.stringify(e);
      } catch (e) {
        reason = 'Could not stringify error message';
      }
    }
    await insertToDB(
      QueueModel,
      new QueueDoc({
        ...queueObj,
        lastFetchedAt: BigInt(Date.now()),
        error: reason,
        numRetries: BigInt(queueObj.numRetries + 1n),
        nextFetchTime: BigInt(delay) + BigInt(Date.now())
      })
    );
  }
}

export const pollNotifications = async () => {
  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.time('pollNotifications');
  }
  try {
    const transferActivityRes = await findInDB(TransferActivityModel, {
      query: { _notificationsHandled: { $exists: false } },
      limit: 25
    });
    const listsActivityRes = await findInDB(ListActivityModel, {
      query: { _notificationsHandled: { $exists: false } },
      limit: 25
    });
    const claimAlertsRes = await findInDB(ClaimAlertModel, {
      query: { _notificationsHandled: { $exists: false } },
      limit: 25
    });

    for (const activityDoc of transferActivityRes) {
      const initiatedBy = activityDoc.initiatedBy;
      const addressesToNotify = [...activityDoc.from, ...activityDoc.to].filter((x) => x !== initiatedBy);
      const message = 'You have received badges';

      for (const address of addressesToNotify) {
        await sendPushNotification(address, NotificationType.TransferActivity, message, activityDoc._docId);
      }
    }
    await insertMany(
      TransferActivityModel,
      transferActivityRes.map((x) => ({ ...x, _notificationsHandled: true }))
    );

    for (const activityDoc of listsActivityRes) {
      const addresses = activityDoc.addresses;
      const message = `You have been added to the list: ${activityDoc.listId}`;

      for (const address of addresses ?? []) {
        await sendPushNotification(address, NotificationType.List, message, activityDoc._docId);
      }
    }
    await insertMany(
      ListActivityModel,
      listsActivityRes.map((x) => ({ ...x, _notificationsHandled: true }))
    );

    for (const claimAlertDoc of claimAlertsRes) {
      const addresses = claimAlertDoc.cosmosAddresses;
      const message = claimAlertDoc.message;

      for (const address of addresses) {
        await sendPushNotification(address, NotificationType.ClaimAlert, message ?? '', claimAlertDoc._docId);
      }
    }
    await insertMany(
      ClaimAlertModel,
      claimAlertsRes.map((x) => ({ ...x, _notificationsHandled: true }))
    );
  } catch (e) {
    // Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [
        {
          _docId: new mongoose.Types.ObjectId().toString(),
          error: serializeError(e),
          function: 'pollNotifications'
        }
      ]);
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.timeEnd('pollNotifications');
  }

  if (SHUTDOWN) return;

  const newTimer = setTimeout(pollNotifications, notificationPollIntervalMs);
  setNotificationPollerTimer(newTimer);
};

export let complianceDoc: ComplianceDoc<bigint> | undefined;

export const poll = async () => {
  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.time('poll');
  }

  try {
    // Connect to the chain client (this is first-time only)
    // This could be in init() but it is here in case indexer is started w/o the chain running
    if (!client) {
      await connectToRpc();
    }

    const clientHeight = await client.getHeight();
    let caughtUp = false;
    // let fastCatchUp = false;

    // We fetch initial status at beginning of block and do not write anything in DB until flush at end of block
    // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block
    // If we are behind, go until we catch up

    let status = await getStatus();

    // Every 50 blocks, query the compliance doc to be used
    if (status.block.height % 50n === 0n || !complianceDoc) {
      complianceDoc = await mustGetFromDB(ComplianceModel, 'compliance');
    }

    while (!caughtUp) {
      // We fetch initial status at beginning of block and do not write anything in DB until flush at end of block
      // IMPORTANT: This is critical because we do not want to double-handle txs if we fail in middle of block

      if (status.block.height >= clientHeight) {
        caughtUp = true;
        break;
      }

      const docs: DocsCache = {
        accounts: {},
        collections: {},
        refreshes: {},
        activityToAdd: [],
        claimAlertsToAdd: [],
        queueDocsToAdd: [],
        merkleChallenges: {},
        addressLists: {},
        approvalTrackers: {},
        balances: {},
        claimBuilderDocs: {},
        protocols: {},
        userProtocolCollections: {}
      };

      const session = await MongoDB.startSession();
      session.startTransaction();
      try {
        // Handle printing of status if there was an outage
        if (outageTime) {
          if (!TIME_MODE) process.stdout.write('\n');
          console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`);
        }
        outageTime = undefined;

        const processing = status.block.height + 1n;
        if (!TIME_MODE) process.stdout.cursorTo(0);

        const block: Block = await client.getBlock(Number(processing));

        if (!TIME_MODE) process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`);
        status.block.timestamp = BigInt(new Date(block.header.time).getTime());

        await handleBlock(block, status, docs, session);

        status.block.height++;
        status.block.txIndex = 0n;

        // Right now, we are banking on all these DB updates succeeding together every time.
        // If there is a failure in the middle, it could be bad.
        const flushed = await flushCachedDocs(docs, session, status, status.block.height < clientHeight);
        if (flushed) {
          const status2 = await mustGetFromDB(StatusModel, 'status', session);
          status = status2;
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
    // Error handling
    // Attempt to reconnect to chain client
    if (e && e.code === 'ECONNREFUSED') {
      try {
        outageTime = outageTime ?? new Date();
        await connectToRpc();

        if (!TIME_MODE) process.stdout.write('\n');
      } catch (e) {
        if (!TIME_MODE) process.stdout.cursorTo(0);
        if (!TIME_MODE) process.stdout.clearLine(1);
        if (!TIME_MODE)
          process.stdout.write(`Error connecting to chain client. ${outageTime ? `Outage Time: ${outageTime.toISOString()}` : ''} Retrying....`);
      }
    }

    // Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [
        {
          _docId: new mongoose.Types.ObjectId().toString(),
          error: serializeError(e),
          function: 'poll'
        }
      ]);
    }
  }

  if (TIME_MODE && QUEUE_TIME_MODE) {
    console.timeEnd('poll');
  }
  if (SHUTDOWN) return;

  const newTimer = setTimeout(poll, pollIntervalMs);
  setTimer(newTimer);
};

const handleEvents = async (events: StringEvent[], status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  try {
    let eventIndex = 0;
    while (eventIndex < events.length) {
      await handleEvent(events[eventIndex], status, docs, txHash);
      eventIndex++;
    }
  } catch (e) {
    // Skipping if the handling failed. Most likely the transaction failed.
  }
};

// TODO: Do this natively via Msgs instead of events?
const handleEvent = async (event: StringEvent, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  if (getAttributeValueByKey(event.attributes, 'amountTrackerId')) {
    const amountTrackerId = getAttributeValueByKey(event.attributes, 'amountTrackerId') ?? '';
    const approverAddress = getAttributeValueByKey(event.attributes, 'approverAddress') ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, 'collectionId') ?? '';
    const approvalLevel =
      (getAttributeValueByKey(event.attributes, 'approvalLevel') as 'collection' | 'incoming' | 'outgoing' | '' | undefined) ?? '';
    const trackerType = getAttributeValueByKey(event.attributes, 'trackerType') ?? '';
    const approvedAddress = getAttributeValueByKey(event.attributes, 'approvedAddress') ?? '';
    const amountsJsonStr = getAttributeValueByKey(event.attributes, 'amounts') ?? '';
    const numTransfersJsonStr = getAttributeValueByKey(event.attributes, 'numTransfers') ?? '';

    const docId = `${collectionId}:${approvalLevel}-${approverAddress}-${amountTrackerId}-${trackerType}-${approvedAddress}`;
    const amounts = JSON.parse(amountsJsonStr && amountsJsonStr !== 'null' ? amountsJsonStr : '[]') as Array<iBalance<string>>;
    const numTransfers = numTransfersJsonStr && numTransfersJsonStr !== 'null' ? BigIntify(JSON.parse(numTransfersJsonStr)) : 0n;

    docs.approvalTrackers[docId] = new ApprovalTrackerDoc({
      _docId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      approvalLevel: approvalLevel || '',
      approverAddress: approverAddress || '',
      amountTrackerId: amountTrackerId || '',
      trackerType: trackerType as 'overall' | 'to' | 'from' | 'initiatedBy',
      approvedAddress: approvedAddress || '',
      numTransfers: BigInt(numTransfers),
      amounts: BalanceArray.From(amounts).convert(BigIntify)
    });
  }

  if (getAttributeValueByKey(event.attributes, 'challengeId')) {
    const challengeId = getAttributeValueByKey(event.attributes, 'challengeId') ?? '';
    const approverAddress = getAttributeValueByKey(event.attributes, 'approverAddress') ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, 'collectionId') ?? '';
    const challengeLevel =
      (getAttributeValueByKey(event.attributes, 'challengeLevel') as 'collection' | 'incoming' | 'outgoing' | '' | undefined) ?? '';
    const leafIndex = getAttributeValueByKey(event.attributes, 'leafIndex') ?? '';

    const docId = `${collectionId}:${challengeLevel}-${approverAddress}-${challengeId}`;
    const currDoc = docs.merkleChallenges[docId];
    const newLeafIndices = currDoc ? currDoc.usedLeafIndices : [];
    newLeafIndices.push(BigIntify(leafIndex || 0n));

    docs.merkleChallenges[docId] = new MerkleChallengeDoc({
      _docId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      challengeId: challengeId || '',
      challengeLevel: challengeLevel || ('' as 'collection' | 'incoming' | 'outgoing' | ''),
      approverAddress: approverAddress || '',
      usedLeafIndices: newLeafIndices
    });
  }

  if (getAttributeValueByKey(event.attributes, 'transfer')) {
    const creator = mustGetAttributeValueByKey(event.attributes, 'creator');
    const collectionId = mustGetAttributeValueByKey(event.attributes, 'collectionId');

    const parsedTransfer = JSON.parse(mustGetAttributeValueByKey(event.attributes, 'transfer'));
    if (parsedTransfer.precalculateBalancesFromApproval) {
      parsedTransfer.precalculateBalancesFromApproval.approvalId = parsedTransfer.precalculateBalancesFromApproval.approvalId || '';
      parsedTransfer.precalculateBalancesFromApproval.approvalLevel = parsedTransfer.precalculateBalancesFromApproval.approvalLevel || '';
      parsedTransfer.precalculateBalancesFromApproval.approverAddress = parsedTransfer.precalculateBalancesFromApproval.approverAddress || '';
    }

    for (const prioritizedApproval of parsedTransfer.prioritizedApprovals ?? []) {
      prioritizedApproval.approvalId = prioritizedApproval.approvalId || '';
      prioritizedApproval.approvalLevel = prioritizedApproval.approvalLevel || '';
      prioritizedApproval.approverAddress = prioritizedApproval.approverAddress || '';
    }

    if (parsedTransfer.merkleProofs) {
      parsedTransfer.merkleProofs = parsedTransfer.merkleProofs.map((proof: MerkleProof) => {
        proof.leaf = proof.leaf || '';
        proof.aunts = proof.aunts || [];
        return proof;
      });
    }

    const transfer = new Transfer(parsedTransfer).convert(BigIntify);
    if (!collectionId || !transfer) throw new Error(`Missing collectionId or transfer in event: ${JSON.stringify(event)}`);
    await fetchDocsForCacheIfEmpty(docs, [], [BigInt(collectionId)], [], [], [], [], [], [], []);
    const collectionDoc = docs.collections[collectionId];
    if (!collectionDoc) throw new Error(`Missing collection doc for collectionId ${collectionId}`);

    await handleTransfers(collectionDoc, [transfer], docs, status, creator, txHash, true);
  }
};

const mustGetAttributeValueByKey = (attributes: Attribute[], key: string): string => {
  const val = getAttributeValueByKey(attributes, key);
  if (!val) throw new Error(`Missing attribute with key ${key}`);
  return val;
};

const getAttributeValueByKey = (attributes: Attribute[], key: string): string | undefined => {
  return attributes.find((attribute: Attribute) => attribute.key === key)?.value;
};

const handleBlock = async (block: Block, status: StatusDoc<bigint>, docs: DocsCache, session: mongoose.ClientSession) => {
  if (block.txs.length > 0 && !TIME_MODE) console.log('');

  // Handle each tx consecutively
  while (status.block.txIndex < block.txs.length) {
    const txHash: string = toHex(sha256(block.txs[Number(status.block.txIndex)])).toUpperCase();
    const indexed: IndexedTx | null = await client.getTx(txHash);
    if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`);
    await handleTx(indexed, status, docs, session);
    status.block.txIndex++;
  }

  // We currently don't read any end blockers (only tx events)
  // const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
  // if (0 < events.length) console.log("HAS EVENTS")
  // await handleEvents(events, status, docs)
};

const handleTx = async (indexed: IndexedTx, status: StatusDoc<bigint>, docs: DocsCache, session: mongoose.ClientSession) => {
  try {
    try {
      JSON.parse(indexed.rawLog);
    } catch (e) {
      console.error(indexed.rawLog);
      throw new Error(`Error parsing rawLog for tx ${indexed.hash}. Skipping tx as it most likely failed...`);
    }
    if (indexed.code) {
      throw new Error(`Non-zero error code for tx ${indexed.hash}. Skipping tx as it most likely failed...`);
    }
  } catch (e) {
    console.log(e);
    return;
  }

  const decodedTx: DecodedTxRaw = decodeTxRaw(indexed.tx);

  // Calculate average gas price over last 1000 txs
  // Note: This is rough and not exact because we are rounding
  const NUM_TXS_TO_AVERAGE = 1000;
  if (decodedTx.authInfo.fee) {
    const gasLimit = decodedTx.authInfo.fee.gasLimit;

    for (const coin of decodedTx.authInfo.fee.amount) {
      const feeAmount = coin.amount;
      const feeDenom = coin.denom;

      if (feeDenom === 'badge') {
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
      case '/protocols.MsgCreateProtocol': {
        const newProtocolMsg = protocoltx.MsgCreateProtocol.fromBinary(value);

        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [newProtocolMsg.name], []);

        docs.protocols[newProtocolMsg.name] = new ProtocolDoc({
          _docId: newProtocolMsg.name,
          ...newProtocolMsg,
          createdBy: newProtocolMsg.creator
        });
        break;
      }
      case '/protocols.MsgUpdateProtocol': {
        const updateProtocolMsg = protocoltx.MsgUpdateProtocol.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [updateProtocolMsg.name], []);
        docs.protocols[updateProtocolMsg.name] = new ProtocolDoc({
          ...docs.protocols[updateProtocolMsg.name],
          _docId: updateProtocolMsg.name,

          createdBy: updateProtocolMsg.creator,
          ...updateProtocolMsg
        });
        break;
      }
      case '/protocols.MsgDeleteProtocol': {
        const deleteProtocolMsg = protocoltx.MsgDeleteProtocol.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [deleteProtocolMsg.name], []);
        delete docs.protocols[deleteProtocolMsg.name];
        await deleteMany(ProtocolModel, [deleteProtocolMsg.name], session);
        break;
      }
      case '/protocols.MsgSetCollectionForProtocol': {
        const setCollectionForProtocolMsg = protocoltx.MsgSetCollectionForProtocol.fromBinary(value);

        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [], [setCollectionForProtocolMsg.creator]);

        let collectionIdToSet = setCollectionForProtocolMsg.collectionId;
        if (BigInt(setCollectionForProtocolMsg.collectionId) === 0n) {
          const prevCollectionId = status.nextCollectionId - 1n;
          collectionIdToSet = prevCollectionId.toString();
        }

        docs.userProtocolCollections[setCollectionForProtocolMsg.creator] = new UserProtocolCollectionsDoc({
          _docId: setCollectionForProtocolMsg.creator,
          protocols: {
            ...docs.userProtocolCollections[setCollectionForProtocolMsg.creator]?.protocols,
            [setCollectionForProtocolMsg.name]: BigInt(collectionIdToSet)
          }
        });

        // TODO: Should we only allow initializations to empty collections?
        if (setCollectionForProtocolMsg.name === 'BitBadges Follow Protocol') {
          await unsetFollowCollection(setCollectionForProtocolMsg.creator);
          await initializeFollowProtocol(setCollectionForProtocolMsg.creator, BigInt(collectionIdToSet));
        }
        break;
      }
      case '/protocols.MsgUnsetCollectionForProtocol': {
        const unsetCollectionForProtocolMsg = protocoltx.MsgUnsetCollectionForProtocol.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [], [unsetCollectionForProtocolMsg.creator]);
        delete docs.userProtocolCollections[unsetCollectionForProtocolMsg.creator]?.protocols[unsetCollectionForProtocolMsg.name];

        if (unsetCollectionForProtocolMsg.name === 'BitBadges Follow Protocol') {
          await unsetFollowCollection(unsetCollectionForProtocolMsg.creator);
        }
        break;
      }
      case '/badges.MsgTransferBadges': {
        const transferMsg = MsgTransferBadges.fromProto(tx.MsgTransferBadges.fromBinary(value), BigIntify);
        await handleMsgTransferBadges(transferMsg, status, docs, indexed.hash);
        break;
      }
      case '/badges.MsgDeleteCollection': {
        const newDeleteMsg = MsgDeleteCollection.fromProto(tx.MsgDeleteCollection.fromBinary(value), BigIntify);
        await handleMsgDeleteCollection(newDeleteMsg, status, docs, session);
        break;
      }
      case '/badges.MsgCreateAddressLists': {
        const newAddressListsMsg = MsgCreateAddressLists.fromProto(tx.MsgCreateAddressLists.fromBinary(value));
        await handleMsgCreateAddressLists(newAddressListsMsg, status, docs, indexed.hash);
        // Don't need to track, we have created at and address lists on-chain are permanent and immutable
        // msg = newAddressListsMsg;
        break;
      }
      case '/badges.MsgUniversalUpdateCollection': {
        const newUpdateCollectionMsg = MsgUniversalUpdateCollection.fromProto(tx.MsgUniversalUpdateCollection.fromBinary(value), BigIntify);
        await handleMsgUniversalUpdateCollection(newUpdateCollectionMsg, status, docs, indexed.hash);
        break;
      }
      case '/badges.MsgCreateCollection': {
        const newCreateMsg = MsgCreateCollection.fromProto(tx.MsgCreateCollection.fromBinary(value), BigIntify);
        await handleMsgCreateCollection(newCreateMsg, status, docs, indexed.hash);
        break;
      }
      case '/badges.MsgUpdateCollection': {
        const newUpdateMsg = MsgUpdateCollection.fromProto(tx.MsgUpdateCollection.fromBinary(value), BigIntify);
        await handleMsgUpdateCollection(newUpdateMsg, status, docs, indexed.hash);
        break;
      }
      case '/badges.MsgUpdateUserApprovals': {
        const newUpdateUserApprovalsMsg = MsgUpdateUserApprovals.fromProto(tx.MsgUpdateUserApprovals.fromBinary(value), BigIntify);
        await handleMsgUpdateUserApprovals(newUpdateUserApprovalsMsg, status, docs, indexed.hash);
        break;
      }
      case '/cosmos.bank.v1beta1.MsgSend': {
        const newMsgSend = bank.MsgSend.fromBinary(value);
        const fromAddress = newMsgSend.fromAddress;
        const toAddress = newMsgSend.toAddress;
        if (fromAddress) await handleNewAccountByAddress(fromAddress, docs);
        if (toAddress) await handleNewAccountByAddress(toAddress, docs);
        // Don't need to track MsgSends
        // msg = newMsgSend;
        break;
      }
      default: {
        break;
      }
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
    console.error('JSON parsing failed. Skipping event as it most likely failed', e);

    await insertMany(ErrorModel, [
      {
        _docId: new mongoose.Types.ObjectId().toString(),
        error: serializeError(e),
        function: 'handleEvents' + ' - ' + indexed.hash
      }
    ]);
  }
};
