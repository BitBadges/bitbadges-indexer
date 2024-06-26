import {
  BalanceDoc,
  ChallengeTrackerIdDetails,
  CollectionDoc,
  CollectionPermissions,
  RefreshDoc,
  UintRangeArray,
  UpdateHistory,
  UserPermissions,
  generateAlias,
  getAliasDerivationKeysForCollection,
  type MsgUniversalUpdateCollection,
  type StatusDoc
} from 'bitbadgesjs-sdk';
import { fetchDocsForCacheIfEmpty } from '../db/cache';
import { handleApprovals } from './approvalInfo';

import { getFromDB, insertToDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel, OffChainUrlModel } from '../db/schemas';
import { type DocsCache } from '../db/types';
import { pushBalancesFetchToQueue, pushCollectionFetchToQueue } from '../queue';
import { handleNewAccountByAddress } from './handleNewAccount';

export function recursivelyDeleteFalseProperties(obj: object): void {
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

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  let collectionId = BigInt(msg.collectionId);
  const isCreateTx = msg.collectionId === 0n;
  if (isCreateTx) {
    collectionId = status.nextCollectionId;

    const aliasAddress = generateAlias('badges', getAliasDerivationKeysForCollection(collectionId));
    docs.collections[status.nextCollectionId.toString()] = new CollectionDoc<bigint>({
      _docId: status.nextCollectionId.toString(),
      collectionId: status.nextCollectionId,
      aliasAddress: aliasAddress,
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
      balancesType: msg.balancesType as 'Standard' | 'Off-Chain - Indexed' | 'Off-Chain - Non-Indexed' | 'Non-Public',
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

    if (
      msg.balancesType === 'Standard' ||
      msg.balancesType === 'Off-Chain - Indexed' ||
      msg.balancesType === 'Off-Chain - Non-Indexed' ||
      msg.balancesType === 'Non-Public'
    ) {
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
    await fetchDocsForCacheIfEmpty(docs, [], [collectionId], [`${collectionId}:Total`, `${collectionId}:Mint`], [], [], [], [], []);
  }
  const collection = docs.collections[collectionId.toString()];
  if (!collection) throw new Error(`Collection ${collectionId} does not exist`);

  collection.updateHistory.push(
    new UpdateHistory({
      block: status.block.height,
      blockTimestamp: status.block.timestamp,
      txHash,
      timestamp: 0n
    })
  );

  const totalBalance = docs.balances[`${collectionId}:Total`];
  if (!totalBalance) throw new Error(`Total balance for collection ${collectionId} does not exist`);

  const mintBalance = docs.balances[`${collectionId}:Mint`];
  if (!mintBalance) throw new Error(`Mint balance for collection ${collectionId} does not exist`);

  if (msg.badgesToCreate != null && msg.badgesToCreate.length > 0) {
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

  await handleApprovals(docs, collection.collectionApprovals, collection.collectionId, status, msg, collection);

  docs.refreshes[collection.collectionId.toString()] = new RefreshDoc({
    _docId: collection.collectionId.toString(),
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp
  });

  if (msg.collectionId === 0n) {
    status.nextCollectionId++;
  }

  // For off-chain URLs, we use a claiming method to avoid data races between indexer and blockchain
  // The ultimate decider is the first on the blockchain

  const customData = collection.offChainBalancesMetadataTimeline?.[0]?.offChainBalancesMetadata?.customData;
  const uri = collection.offChainBalancesMetadataTimeline?.[0]?.offChainBalancesMetadata?.uri;

  const toClaimIndexed =
    uri &&
    uri.startsWith('https://bitbadges-balances.nyc3.digitaloceanspaces.com/balances/') &&
    customData === uri.split('/').pop() &&
    collection.balancesType === 'Off-Chain - Indexed';
  const toClaimNonIndexed =
    uri && uri.startsWith('https://api.bitbadges.io/placeholder/{address}') && customData && collection.balancesType === 'Off-Chain - Non-Indexed';

  if (isCreateTx) {
    if (toClaimIndexed || toClaimNonIndexed) {
      const existingDoc = await getFromDB(OffChainUrlModel, customData);
      const creator = existingDoc?.createdBy;
      if (existingDoc && creator && creator === msg.creator) {
        await insertToDB(OffChainUrlModel, {
          ...existingDoc,
          collectionId: Number(collection.collectionId)
        });

        // This is for off-chain balance types
        // If we just claimed, we can claim all others with the balances
        const existingClaimBuilderDocs = await findInDB(ClaimBuilderModel, {
          query: { cid: customData, docClaimed: false, deletedAt: { $exists: false }, createdBy: msg.creator }
        });
        for (const doc of existingClaimBuilderDocs) {
          doc.collectionId = collection.collectionId;
          doc.docClaimed = true;
          doc.trackerDetails = new ChallengeTrackerIdDetails({
            approvalId: '',
            approvalLevel: 'collection',
            approverAddress: '',
            collectionId: collection.collectionId,
            challengeTrackerId: customData
          });
          await insertToDB(ClaimBuilderModel, doc);
        }
      }
    }
  }
};
