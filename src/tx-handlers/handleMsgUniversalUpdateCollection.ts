import {
  BalanceDoc,
  CollectionDoc,
  CollectionPermissions,
  RefreshDoc,
  UintRangeArray,
  UpdateHistory,
  UserPermissions,
  type MsgUniversalUpdateCollection,
  type StatusDoc
} from 'bitbadgesjs-sdk';
import { fetchDocsForCacheIfEmpty } from '../db/cache';
import { handleApprovals } from './approvalInfo';

import { getFromDB, insertToDB } from '../db/db';
import { client } from '../indexer';
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue } from '../queue';
import { handleNewAccountByAddress } from './handleNewAccount';
import { type DocsCache } from '../db/types';
import { OffChainUrlModel, ClaimBuilderModel } from '../db/schemas';
import { findInDB } from '../db/queries';

export function recursivelyDeleteFalseProperties(obj: object) {
  if (Array.isArray(obj)) {
    obj.forEach((item: object) => {
      recursivelyDeleteFalseProperties(item);
    });
    return;
  }

  if (typeof obj !== 'object' || obj === null) {
    return;
  }

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const prop = obj[key as keyof typeof obj] as unknown;

      if (prop && typeof prop === 'object') {
        recursivelyDeleteFalseProperties(prop);
      }
    }
  }
}

export const handleMsgUniversalUpdateCollection = async (
  msg: MsgUniversalUpdateCollection<bigint>,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  txHash: string
): Promise<void> => {
  recursivelyDeleteFalseProperties(msg);

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  let collectionId = BigInt(msg.collectionId);
  if (msg.collectionId === 0n) {
    collectionId = status.nextCollectionId;

    // TODO: Do this natively
    const collection = await client.badgesQueryClient?.badges.getCollection(collectionId.toString());
    if (!collection) throw new Error(`Collection ${collectionId} does not exist`);

    docs.collections[status.nextCollectionId.toString()] = new CollectionDoc<bigint>({
      _docId: status.nextCollectionId.toString(),
      collectionId: status.nextCollectionId,
      aliasAddress: collection.aliasAddress,
      managerTimeline: [
        {
          manager: msg.creator,
          // Go Max Uint 64
          timelineTimes: UintRangeArray.FullRanges()
        }
      ],
      createdBlock: status.block.height,
      createdTimestamp: status.block.timestamp,
      defaultBalances: msg.defaultBalances ?? {
        balances: [],
        incomingApprovals: [],
        outgoingApprovals: [],
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        userPermissions: UserPermissions.InitEmpty()
      },
      createdBy: msg.creator,
      balancesType: msg.balancesType as 'Standard' | 'Inherited' | 'Off-Chain - Indexed' | 'Off-Chain - Non-Indexed',
      collectionApprovals: [],
      collectionMetadataTimeline: [],
      badgeMetadataTimeline: [],
      offChainBalancesMetadataTimeline: [],
      customDataTimeline: [],
      standardsTimeline: [],
      isArchivedTimeline: [],
      collectionPermissions: CollectionPermissions.InitEmpty(),
      updateHistory: []
    });

    if (msg.balancesType === 'Standard' || msg.balancesType === 'Off-Chain - Indexed' || msg.balancesType === 'Off-Chain - Non-Indexed') {
      docs.balances[`${status.nextCollectionId}:Total`] = new BalanceDoc({
        _docId: `${status.nextCollectionId.toString()}:Total`,
        balances: [],
        cosmosAddress: 'Total',
        collectionId: status.nextCollectionId,
        onChain: true,
        outgoingApprovals: [],
        incomingApprovals: [],
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        userPermissions: UserPermissions.InitEmpty(),
        updateHistory: []
      });

      docs.balances[`${status.nextCollectionId}:Mint`] = new BalanceDoc({
        _docId: `${status.nextCollectionId.toString()}:Mint`,
        balances: [],
        cosmosAddress: 'Mint',
        collectionId: status.nextCollectionId,
        onChain: true,
        outgoingApprovals: [],
        incomingApprovals: [],
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        userPermissions: UserPermissions.InitEmpty(),
        updateHistory: []
      });
    }
  } else {
    await fetchDocsForCacheIfEmpty(docs, [], [collectionId], [`${collectionId}:Total`, `${collectionId}:Mint`], [], [], [], [], [], []);
  }
  const collection = docs.collections[collectionId.toString()];
  if (!collection) throw new Error(`Collection ${collectionId} does not exist`);

  collection.updateHistory.push(
    new UpdateHistory({
      block: status.block.height,
      blockTimestamp: status.block.timestamp,
      txHash
    })
  );

  const totalBalance = docs.balances[`${collectionId}:Total`];
  if (!totalBalance) throw new Error(`Total balance for collection ${collectionId} does not exist`);

  const mintBalance = docs.balances[`${collectionId}:Mint`];
  if (!mintBalance) throw new Error(`Mint balance for collection ${collectionId} does not exist`);

  if (msg.badgesToCreate && msg.badgesToCreate.length > 0) {
    totalBalance.balances.addBalances(msg.badgesToCreate);
    mintBalance.balances.addBalances(msg.badgesToCreate);
  }

  const entropy = status.block.height.toString() + '-' + status.block.txIndex.toString();

  if (msg.updateCollectionPermissions) {
    collection.collectionPermissions = msg.collectionPermissions ?? CollectionPermissions.InitEmpty();
  }

  if (msg.updateManagerTimeline) {
    collection.managerTimeline = msg.managerTimeline ?? [];
  }

  if (msg.updateCollectionMetadataTimeline) {
    collection.collectionMetadataTimeline = msg.collectionMetadataTimeline ?? [];
  }

  if (msg.updateBadgeMetadataTimeline) {
    collection.badgeMetadataTimeline = msg.badgeMetadataTimeline ?? [];
  }

  if (msg.updateCollectionMetadataTimeline === true || msg.updateBadgeMetadataTimeline === true) {
    await pushCollectionFetchToQueue(docs, collection, status.block.timestamp, entropy);
  }

  if (msg.updateOffChainBalancesMetadataTimeline) {
    collection.offChainBalancesMetadataTimeline = msg.offChainBalancesMetadataTimeline ?? [];
    await pushBalancesFetchToQueue(docs, collection, status.block.timestamp, entropy);
  }

  if (msg.updateCustomDataTimeline) {
    collection.customDataTimeline = msg.customDataTimeline ?? [];
  }

  if (msg.updateCollectionApprovals) {
    collection.collectionApprovals = msg.collectionApprovals ?? [];
  }

  if (msg.updateStandardsTimeline) {
    collection.standardsTimeline = msg.standardsTimeline ?? [];
  }

  if (msg.updateIsArchivedTimeline) {
    collection.isArchivedTimeline = msg.isArchivedTimeline ?? [];
  }

  await handleApprovals(docs, collection, status, msg.collectionId === 0n);

  docs.refreshes[collection.collectionId.toString()] = new RefreshDoc({
    _docId: collection.collectionId.toString(),
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp
  });

  if (msg.collectionId === 0n) {
    status.nextCollectionId++;
  }

  //For off-chain URLs, we use a claiming method to avoid data races between indexer and blockchain
  //The ultimate decider is the first on the blockchain

  const customData = collection.offChainBalancesMetadataTimeline?.[0]?.offChainBalancesMetadata?.customData;
  const uri = collection.offChainBalancesMetadataTimeline?.[0]?.offChainBalancesMetadata?.uri;

  const toClaimIndexed =
    uri && uri.startsWith('https://bitbadges-balances.nyc3.digitaloceanspaces.com/balances/') && customData === uri.split('/').pop();
  const toClaimNonIndexed = uri && uri.startsWith('https://api.bitbadges.io/placeholder/{address}') && customData;

  if (toClaimIndexed || toClaimNonIndexed) {
    const existingDoc = await getFromDB(OffChainUrlModel, customData);
    if (!existingDoc) {
      await insertToDB(OffChainUrlModel, {
        _docId: customData,
        collectionId: Number(collection.collectionId)
      });
    }

    //If we just claimed the customData or already claimed, we can claim all others with the balances
    if (!existingDoc || BigInt(existingDoc.collectionId) == collection.collectionId) {
      const existingClaimBuilderDocs = await findInDB(ClaimBuilderModel, { query: { cid: customData, docClaimed: false } });
      for (const doc of existingClaimBuilderDocs) {
        doc.collectionId = collection.collectionId;
        doc.docClaimed = true;
        await insertToDB(ClaimBuilderModel, doc);
      }
    }
  }
};
