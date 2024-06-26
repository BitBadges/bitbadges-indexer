import { sha256 } from '@cosmjs/crypto';
import { toHex } from '@cosmjs/encoding';
import { decodeTxRaw, type DecodedTxRaw } from '@cosmjs/proto-signing';
import { type Block, type IndexedTx } from '@cosmjs/stargate';
import {
  ApprovalTrackerDoc,
  BalanceArray,
  BigIntify,
  MapDoc,
  MerkleChallengeDoc,
  MsgCreateAddressLists,
  MsgCreateCollection,
  MsgDeleteCollection,
  MsgTransferBadges,
  MsgUniversalUpdateCollection,
  MsgUpdateCollection,
  MsgUpdateUserApprovals,
  Transfer,
  UintRangeArray,
  UpdateHistory,
  UsedLeafStatus,
  convertToCosmosAddress,
  type AddressListDoc,
  type ComplianceDoc,
  type MerkleProof,
  type NumberType,
  type StatusDoc,
  type ZkProofSolution,
  type iBalance
} from 'bitbadgesjs-sdk';
import * as tx from 'bitbadgesjs-sdk/dist/proto/badges/tx_pb';
import * as bank from 'bitbadgesjs-sdk/dist/proto/cosmos/bank/v1beta1/tx_pb';
import * as maps from 'bitbadgesjs-sdk/dist/proto/maps/tx_pb';
import * as solana from 'bitbadgesjs-sdk/dist/proto/solana/web3_pb';
import { ValueStore } from 'bitbadgesjs-sdk/dist/transactions/messages/bitbadges/maps';
import { type Attribute, type StringEvent } from 'cosmjs-types/cosmos/base/abci/v1beta1/abci';

import sgMail from '@sendgrid/mail';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { IndexerStargateClient } from './chain-client/indexer_stargateclient';
import { fetchDocsForCacheIfEmpty, flushCachedDocs } from './db/cache';
import { MongoDB, deleteMany, getManyFromDB, insertMany, mustGetFromDB } from './db/db';
import { findInDB } from './db/queries';
import {
  AddressListModel,
  ClaimAlertModel,
  ComplianceModel,
  ErrorModel,
  ListActivityModel,
  MapModel,
  StatusModel,
  TransferActivityModel
} from './db/schemas';
import { getStatus } from './db/status';
import { type DocsCache } from './db/types';
import { SHUTDOWN, setNotificationPollerTimer, setTimer, setUriPollerTimer } from './indexer';
import { client, setClient } from './indexer-vars';
import { NotificationType, sendPushNotification } from './pollutils';
import { getMapIdForQueueDb, handleQueueItems, pushMapFetchToQueue } from './queue';
import { getAdminDetails } from './routes/admin';
import { handleMsgCreateAddressLists } from './tx-handlers/handleMsgCreateAddressLists';
import { handleMsgCreateCollection } from './tx-handlers/handleMsgCreateCollection';
import { handleMsgDeleteCollection } from './tx-handlers/handleMsgDeleteCollection';
import { handleMsgTransferBadges } from './tx-handlers/handleMsgTransferBadges';
import { handleMsgUniversalUpdateCollection } from './tx-handlers/handleMsgUniversalUpdateCollection';
import { handleMsgUpdateCollection } from './tx-handlers/handleMsgUpdateCollection';
import { handleMsgUpdateUserApprovals } from './tx-handlers/handleMsgUpdateUserApprovals';
import { handleNewAccountByAddress } from './tx-handlers/handleNewAccount';
import { handleTransfers } from './tx-handlers/handleTransfers';
import { getLoadBalancerId } from './utils/loadBalancer';

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

export const pollUris = async () => {
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
          error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
          function: 'pollUris'
        }
      ]);
    }
  }

  if (SHUTDOWN) {
    console.log('Shutting down URI poller');
    setUriPollerTimer(undefined);
    return;
  }

  const newTimer = setTimeout(pollUris, uriPollIntervalMs);
  setUriPollerTimer(newTimer);
};

//In dev, we often restart so we dont want to spam with emails
let lastAdminReportSent = process.env.DEV_MODE === 'true' ? Date.now() : 0;

export const pollNotifications = async () => {
  try {
    if (lastAdminReportSent + 1000 * 60 * 60 * 4 < Date.now()) {
      const { pluginSubmissions, reports, queueErrors, errorDocs, faucetBalance } = await getAdminDetails(false);
      if (pluginSubmissions.length === 0 && reports.length === 0 && queueErrors.length === 0 && errorDocs.length === 0) {
      } else {
        const emails: Array<{
          to: string;
          from: string;
          subject: string;
          html: string;
        }> = [
          {
            to: 'trevormil@comcast.net',
            from: 'info@mail.bitbadges.io',
            subject: 'Admin Report - ' + (process.env.DEV_MODE === 'true' ? 'DEV' : 'PROD'),
            html: `<p>Admin Report: ${new Date().toISOString()}</p>
          <p>Plugin Submissions: ${pluginSubmissions.length}</p>
          <p>Reports: ${reports.length}</p>
          <p>Queue Errors: ${queueErrors.length}</p>
          <p>Errors: ${errorDocs.length}</p>
          <p>Faucet Balance: ${JSON.stringify(faucetBalance)}</p>
          <br />
          <br />

          <p>${JSON.stringify({ pluginSubmissions, reports, queueErrors, errorDocs })}</p>`
          }
        ];

        sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
        await sgMail.send(emails, true);

        lastAdminReportSent = Date.now();
      }
    }

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
      const addressesToNotify = [...activityDoc.from, ...activityDoc.to];
      const message = 'You have received badges';

      for (const address of addressesToNotify) {
        await sendPushNotification(address, NotificationType.TransferActivity, message, activityDoc._docId, activityDoc.initiatedBy);
      }
    }

    await insertMany(
      TransferActivityModel,
      transferActivityRes.map((x) => ({ ...x, _notificationsHandled: true }))
    );

    const listIds = [...new Set(listsActivityRes.map((x) => x.listId))];
    let lists: Array<AddressListDoc<bigint>> = [];
    if (listIds.length > 0) {
      const listDocs = await getManyFromDB(AddressListModel, listIds);
      lists = listDocs.filter((x) => x).filter((x) => !x?.private) as Array<AddressListDoc<bigint>>;
    }

    for (const activityDoc of listsActivityRes) {
      const addresses = activityDoc.addresses;
      const message = `You have been added to the list: ${activityDoc.listId}`;

      // Don't send notifications for private lists
      if (!lists.map((x) => x.listId).includes(activityDoc.listId)) {
        continue;
      }

      for (const address of addresses ?? []) {
        await sendPushNotification(address, NotificationType.List, message, activityDoc._docId, activityDoc.initiatedBy);
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
          error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
          function: 'pollNotifications'
        }
      ]);
    }
  }

  if (SHUTDOWN) {
    console.log('Shutting down notification poller');
    setNotificationPollerTimer(undefined);
    return;
  }

  const newTimer = setTimeout(pollNotifications, notificationPollIntervalMs);
  setNotificationPollerTimer(newTimer);
};

export let complianceDoc: ComplianceDoc<bigint> | undefined;

export const poll = async () => {
  try {
    // Connect to the chain client (this is first-time only)
    // This could be in init() but it is here in case indexer is started w/o the chain running
    if (!client) {
      await connectToRpc();
    }

    if (!client) {
      throw new Error('Could not connect to any chain client');
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

    const emptyBlocksCache: DocsCache = {
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
      maps: {}
    };

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
        maps: {}
      };

      const session = await MongoDB.startSession();
      session.startTransaction();
      try {
        // Handle printing of status if there was an outage
        if (outageTime) {
          process.stdout.write('\n');
          console.log(`Reconnected to chain at block ${status.block.height} after outage of ${new Date().getTime() - outageTime.getTime()} ms`);
        }
        outageTime = undefined;

        const processing = status.block.height + 1n;
        process.stdout.cursorTo(0);

        const block: Block = await client.getBlock(Number(processing)).catch((e) => {
          console.log(e);
          throw e;
        });

        process.stdout.write(`Handling block: ${processing} with ${block.txs.length} txs`);
        status.block.timestamp = BigInt(new Date(block.header.time).getTime());

        await handleBlock(block, status, docs, session, emptyBlocksCache);

        status.block.height++;
        status.block.txIndex = 0n;

        // Right now, we are banking on all these DB updates succeeding together every time.
        // If there is a failure in the middle, it could be bad.
        const skipStatusFlushIfEmptyBlock = status.block.height < clientHeight;
        const flushed = await flushCachedDocs(
          {
            ...docs,
            emptyBlocks: status.block.height >= clientHeight ? emptyBlocksCache.emptyBlocks : undefined
          },
          session,
          status,
          skipStatusFlushIfEmptyBlock
        );
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

        process.stdout.write('\n');
      } catch (e) {
        process.stdout.cursorTo(0);
        process.stdout.clearLine(1);
        process.stdout.write(`Error connecting to chain client. ${outageTime ? `Outage Time: ${outageTime.toISOString()}` : ''} Retrying....`);
      }
    }

    // Log error to DB, unless it is a connection refused error
    if (e && e.code !== 'ECONNREFUSED') {
      console.error(e);

      await insertMany(ErrorModel, [
        {
          _docId: new mongoose.Types.ObjectId().toString(),
          error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
          function: 'poll'
        }
      ]);
    }
  }

  if (SHUTDOWN) {
    console.log('Shutting down poller');
    setTimer(undefined);
    return;
  }

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
    const approvalId = getAttributeValueByKey(event.attributes, 'approvalId') ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, 'collectionId') ?? '';
    const approvalLevel =
      (getAttributeValueByKey(event.attributes, 'approvalLevel') as 'collection' | 'incoming' | 'outgoing' | '' | undefined) ?? '';
    const trackerType = getAttributeValueByKey(event.attributes, 'trackerType') ?? '';
    const approvedAddress = getAttributeValueByKey(event.attributes, 'approvedAddress') ?? '';
    const amountsJsonStr = getAttributeValueByKey(event.attributes, 'amounts') ?? '';
    const numTransfersJsonStr = getAttributeValueByKey(event.attributes, 'numTransfers') ?? '';

    const docId = `${collectionId}:${approvalLevel}-${approverAddress}-${approvalId}-${amountTrackerId}-${trackerType}-${approvedAddress}`;
    const amounts = JSON.parse(amountsJsonStr && amountsJsonStr !== 'null' ? amountsJsonStr : '[]') as Array<iBalance<string>>;
    const numTransfers = numTransfersJsonStr && numTransfersJsonStr !== 'null' ? BigIntify(JSON.parse(numTransfersJsonStr)) : 0n;

    docs.approvalTrackers[docId] = new ApprovalTrackerDoc({
      _docId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      approvalId: approvalId || '',
      approvalLevel: approvalLevel || '',
      approverAddress: approverAddress || '',
      amountTrackerId: amountTrackerId || '',
      trackerType: trackerType as 'overall' | 'to' | 'from' | 'initiatedBy',
      approvedAddress: approvedAddress || '',
      numTransfers: BigInt(numTransfers),
      amounts: BalanceArray.From(amounts).convert(BigIntify)
    });
  }

  if (getAttributeValueByKey(event.attributes, 'challengeTrackerId')) {
    const creator = mustGetAttributeValueByKey(event.attributes, 'creator');
    const challengeTrackerId = getAttributeValueByKey(event.attributes, 'challengeTrackerId') ?? '';
    const approvalId = getAttributeValueByKey(event.attributes, 'approvalId') ?? '';
    const approverAddress = getAttributeValueByKey(event.attributes, 'approverAddress') ?? '';
    const collectionId = getAttributeValueByKey(event.attributes, 'collectionId') ?? '';
    const approvalLevel =
      (getAttributeValueByKey(event.attributes, 'approvalLevel') as 'collection' | 'incoming' | 'outgoing' | '' | undefined) ?? '';
    const leafIndex = getAttributeValueByKey(event.attributes, 'leafIndex') ?? '';

    const docId = `${collectionId}:${approvalLevel}-${approverAddress}-${approvalId}-${challengeTrackerId}`;
    const currDoc = docs.merkleChallenges[docId];
    const newLeafIndices = currDoc ? currDoc.usedLeafIndices : [];
    newLeafIndices.push(new UsedLeafStatus({ leafIndex: BigIntify(leafIndex || 0n), usedBy: creator }));

    docs.merkleChallenges[docId] = new MerkleChallengeDoc({
      _docId: docId,
      collectionId: collectionId ? BigIntify(collectionId) : 0n,
      challengeTrackerId: challengeTrackerId || '',
      approvalId: approvalId || '',
      approvalLevel: approvalLevel || ('' as 'collection' | 'incoming' | 'outgoing' | ''),
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

    if (parsedTransfer.zkProofSolutions) {
      parsedTransfer.zkProofSolutions = parsedTransfer.zkProofSolutions.map((proof: ZkProofSolution) => {
        proof.publicInputs = proof.publicInputs || '';
        proof.proof = proof.proof || '';
        return proof;
      });
    }

    const transfer = new Transfer(parsedTransfer).convert(BigIntify);
    if (!collectionId || !transfer) throw new Error(`Missing collectionId or transfer in event: ${JSON.stringify(event)}`);
    await fetchDocsForCacheIfEmpty(docs, [], [BigInt(collectionId)], [], [], [], [], [], []);
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

const handleBlock = async (
  block: Block,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  session: mongoose.ClientSession,
  emptyBlocksCache: DocsCache
) => {
  if (block.txs.length > 0) console.log('');

  if (block.txs.length == 0) {
    if (emptyBlocksCache.emptyBlocks === undefined) {
      emptyBlocksCache.emptyBlocks = new UintRangeArray<bigint>();
    }

    emptyBlocksCache.emptyBlocks.push({ start: BigInt(block.header.height), end: BigInt(block.header.height) });
    emptyBlocksCache.emptyBlocks = emptyBlocksCache.emptyBlocks.sortAndMerge();
  }

  // Handle each tx consecutively
  while (status.block.txIndex < block.txs.length) {
    const txHash: string = toHex(sha256(block.txs[Number(status.block.txIndex)])).toUpperCase();
    if (!client) {
      throw new Error('Could not connect to any chain client');
    }

    const indexed: IndexedTx | null = await client.getTx(txHash);
    if (!indexed) throw new Error(`Could not find indexed tx: ${txHash}`);
    await handleTx(indexed, status, docs, session);
    status.block.txIndex++;
  }

  // We currently don't read any end blockers (only tx events)
  // const events: StringEvent[] = await client.getEndBlockEvents(block.header.height)
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
    const gasUsed = indexed.gasUsed;

    if (decodedTx.authInfo.fee.amount.length === 1) {
      for (const coin of decodedTx.authInfo.fee.amount) {
        const feeAmount = coin.amount;
        const feeDenom = coin.denom;

        if (feeDenom === 'ubadge') {
          status.lastXGasAmounts.push(BigInt(feeAmount));
          status.lastXGasLimits.push(BigInt(gasUsed.toString()));

          if (status.lastXGasAmounts.length > NUM_TXS_TO_AVERAGE) {
            status.lastXGasAmounts.shift();
            status.lastXGasLimits.shift();
          }

          status.gasPrice = Number(status.lastXGasAmounts.reduce((a, b) => a + b, 0n)) / Number(status.lastXGasLimits.reduce((a, b) => a + b, 0n));
        }
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
      case '/maps.MsgCreateMap': {
        const newMapMsg = maps.MsgCreateMap.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [newMapMsg.mapId]);

        docs.maps[newMapMsg.mapId] = new MapDoc<NumberType>({
          _docId: newMapMsg.mapId,
          values: {},
          ...newMapMsg,
          updateCriteria: newMapMsg.updateCriteria || {
            managerOnly: false,
            collectionId: 0n,
            creatorOnly: false,
            firstComeFirstServe: false
          },
          valueOptions: newMapMsg.valueOptions || {
            noDuplicates: false,
            expectAddress: false,
            expectBoolean: false,
            expectUint: false,
            expectUri: false,
            permanentOnceSet: false
          },
          permissions: newMapMsg.permissions || {
            canDeleteMap: [],
            canUpdateManager: [],
            canUpdateMetadata: []
          },
          metadataTimeline: newMapMsg.metadataTimeline.map((x) => {
            return {
              metadata: x.metadata ?? { uri: '', customData: '' },
              timelineTimes: x.timelineTimes
            };
          }),
          updateHistory: [
            {
              block: status.block.height,
              txHash: indexed.hash,
              blockTimestamp: status.block.timestamp,
              timestamp: 0n
            }
          ]
        }).convert(BigIntify);

        const uri = newMapMsg.metadataTimeline.find((x) => UintRangeArray.From(x.timelineTimes).searchIfExists(BigInt(Date.now())))?.metadata?.uri;
        if (uri) {
          const entropy = `${status.block.height}:${indexed.hash}:${newMapMsg.mapId}`;

          await pushMapFetchToQueue(
            docs,
            newMapMsg.mapId,
            uri,
            getLoadBalancerId(getMapIdForQueueDb(entropy, newMapMsg.mapId.toString(), uri.toString())),
            status.block.timestamp,
            entropy
          );
        }
        break;
      }
      case '/maps.MsgUpdateMap': {
        const updateMapMsg = maps.MsgUpdateMap.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [updateMapMsg.mapId]);

        const doc = docs.maps[updateMapMsg.mapId];
        if (!doc) {
          throw new Error(`Map ${updateMapMsg.mapId} does not exist`);
        }

        const tempDoc = new MapDoc<NumberType>({
          ...doc,
          ...updateMapMsg,
          permissions: updateMapMsg.permissions || {
            canDeleteMap: [],
            canUpdateManager: [],
            canUpdateMetadata: []
          },
          metadataTimeline: updateMapMsg.metadataTimeline.map((x) => {
            return {
              metadata: x.metadata ?? { uri: '', customData: '' },
              timelineTimes: x.timelineTimes
            };
          })
        }).convert(BigIntify);

        if (updateMapMsg.updateManagerTimeline) {
          doc.managerTimeline = tempDoc.managerTimeline;
        }

        if (updateMapMsg.updateMetadataTimeline) {
          doc.metadataTimeline = tempDoc.metadataTimeline;
          const uri = updateMapMsg.metadataTimeline.find((x) => UintRangeArray.From(x.timelineTimes).searchIfExists(BigInt(Date.now())))?.metadata
            ?.uri;
          if (uri) {
            const entropy = `${status.block.height}:${indexed.hash}:${updateMapMsg.mapId}`;

            await pushMapFetchToQueue(
              docs,
              updateMapMsg.mapId,
              uri,
              getLoadBalancerId(getMapIdForQueueDb(entropy, updateMapMsg.mapId.toString(), uri.toString())),
              status.block.timestamp,
              entropy
            );
          }
        }

        if (updateMapMsg.updatePermissions) {
          doc.permissions = tempDoc.permissions;
        }

        doc.updateHistory.push(
          new UpdateHistory({
            block: status.block.height,
            txHash: indexed.hash,
            blockTimestamp: status.block.timestamp,
            timestamp: 0n
          })
        );

        docs.maps[updateMapMsg.mapId] = doc;
        break;
      }
      case '/maps.MsgDeleteMap': {
        const deleteMapMsg = maps.MsgDeleteMap.fromBinary(value);

        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [deleteMapMsg.mapId]);

        delete docs.maps[deleteMapMsg.mapId];
        await deleteMany(MapModel, [deleteMapMsg.mapId], session);
        break;
      }
      case '/maps.MsgSetValue': {
        const setValueMsg = maps.MsgSetValue.fromBinary(value);
        await fetchDocsForCacheIfEmpty(docs, [], [], [], [], [], [], [], [setValueMsg.mapId]);

        let finalSetValue = setValueMsg.value;
        if (setValueMsg.options?.useMostRecentCollectionId) {
          finalSetValue = (status.nextCollectionId - 1n).toString();
        }

        const doc = docs.maps[setValueMsg.mapId];
        if (!doc) {
          throw new Error(`Map ${setValueMsg.mapId} does not exist`);
        }

        doc.values[setValueMsg.key] = new ValueStore({ key: setValueMsg.key, value: finalSetValue, lastSetBy: setValueMsg.creator });
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
        error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
        function: 'handleEvents' + ' - ' + indexed.hash
      }
    ]);
  }
};
