import { MsgUpdateCollection } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc, addBalances } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleMerkleChallenges } from "./merkleChallenges"

import { getBalancesIdForQueueDb, getCollectionIdForQueueDb, pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../metadata-queue"
import { getLoadBalancerId } from "../utils/loadBalancer"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgUpdateCollection = async (msg: MsgUpdateCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  if (msg.collectionId === 0n) {
    docs.collections[msg.collectionId.toString()] = {
      _id: msg.collectionId.toString(),
      _rev: '',
      collectionId: status.nextCollectionId,

      managerTimeline: [{
        manager: msg.creator,
        //Go Max Uint 64
        timelineTimes: [{ start: 1n, end: BigInt("18446744073709551615") }],
      }],
      createdBlock: status.block.height,
      defaultUserApprovedIncomingTransfersTimeline: msg.defaultApprovedIncomingTransfersTimeline,
      defaultUserApprovedOutgoingTransfersTimeline: msg.defaultApprovedOutgoingTransfersTimeline,
      defaultUserPermissions: msg.defaultUserPermissions,
      createdBy: msg.creator,
      balancesType: msg.balancesType as "Standard" | "Inherited" | "Off-Chain",
      collectionApprovedTransfersTimeline: [],
      collectionMetadataTimeline: [],
      badgeMetadataTimeline: [],
      offChainBalancesMetadataTimeline: [],
      customDataTimeline: [],
      inheritedBalancesTimeline: [],
      standardsTimeline: [],
      contractAddressTimeline: [],
      isArchivedTimeline: [],
      collectionPermissions: {
        canUpdateCollectionMetadata: [],
        canArchiveCollection: [],
        canUpdateBadgeMetadata: [],
        canCreateMoreBadges: [],
        canDeleteCollection: [],
        canUpdateCollectionApprovedTransfers: [],
        canUpdateContractAddress: [],
        canUpdateCustomData: [],
        canUpdateInheritedBalances: [],
        canUpdateManager: [],
        canUpdateOffChainBalancesMetadata: [],
        canUpdateStandards: [],
      },
    }

    docs.balances[`${status.nextCollectionId}:Total`] = {
      _id: `${status.nextCollectionId.toString()}:Total`,
      _rev: '',
      balances: [],
      cosmosAddress: "Total",
      collectionId: status.nextCollectionId,
      onChain: true,
      approvedOutgoingTransfersTimeline: [],
      approvedIncomingTransfersTimeline: [],
      userPermissions: {
        canUpdateApprovedIncomingTransfers: [],
        canUpdateApprovedOutgoingTransfers: [],
      }
    }

    docs.balances[`${status.nextCollectionId}:Mint`] = {
      _id: `${status.nextCollectionId.toString()}:Mint`,
      _rev: '',
      balances: [],
      cosmosAddress: "Mint",
      collectionId: status.nextCollectionId,
      onChain: true,
      approvedOutgoingTransfersTimeline: [],
      approvedIncomingTransfersTimeline: [],
      userPermissions: {
        canUpdateApprovedIncomingTransfers: [],
        canUpdateApprovedOutgoingTransfers: [],
      }
    }

  } else {
    if (msg.badgesToCreate && msg.badgesToCreate.length > 0) {
      await fetchDocsForCacheIfEmpty(docs, [], [msg.collectionId], [
        `${msg.collectionId}:Total`,
        `${msg.collectionId}:Mint`,
      ], [], [], []);
    }
  }

  const collection = docs.collections[msg.collectionId.toString()];
  if (!collection) throw new Error(`Collection ${msg.collectionId} does not exist`);

  const totalBalance = docs.balances[`${msg.collectionId}:Total`];
  if (!totalBalance) throw new Error(`Total balance for collection ${msg.collectionId} does not exist`);

  const mintBalance = docs.balances[`${msg.collectionId}:Mint`];
  if (!mintBalance) throw new Error(`Mint balance for collection ${msg.collectionId} does not exist`);

  if (msg.badgesToCreate && msg.badgesToCreate.length > 0) {
    totalBalance.balances = addBalances(msg.badgesToCreate, totalBalance.balances);
    mintBalance.balances = addBalances(msg.badgesToCreate, mintBalance.balances);
  }

  const entropy = status.block.height + "-" + status.block.txIndex;
  const docId = getCollectionIdForQueueDb(entropy, collection.collectionId.toString());
  const balanceDocId = getBalancesIdForQueueDb(entropy, collection.collectionId.toString());

  if (msg.updateCollectionPermissions) {
    collection.collectionPermissions = msg.collectionPermissions;
  }

  if (msg.updateManagerTimeline) {
    collection.managerTimeline = msg.managerTimeline;
  }

  if (msg.updateCollectionMetadataTimeline) {
    collection.collectionMetadataTimeline = msg.collectionMetadataTimeline;
  }

  if (msg.updateBadgeMetadataTimeline) {
    collection.badgeMetadataTimeline = msg.badgeMetadataTimeline;
  }

  if (msg.updateCollectionMetadataTimeline || msg.updateBadgeMetadataTimeline) {
    await pushCollectionFetchToQueue(docs, collection, getLoadBalancerId(docId), status.block.timestamp, entropy);
  }

  if (msg.updateOffChainBalancesMetadataTimeline) {
    collection.offChainBalancesMetadataTimeline = msg.offChainBalancesMetadataTimeline;
    await pushBalancesFetchToQueue(docs, collection, getLoadBalancerId(balanceDocId), status.block.timestamp, entropy);
  }

  if (msg.updateCustomDataTimeline) {
    collection.customDataTimeline = msg.customDataTimeline;
  }

  if (msg.updateInheritedBalancesTimeline) {
    collection.inheritedBalancesTimeline = msg.inheritedBalancesTimeline;
  }

  if (msg.updateCollectionApprovedTransfersTimeline) {
    collection.collectionApprovedTransfersTimeline = msg.collectionApprovedTransfersTimeline;
  }

  if (msg.updateStandardsTimeline) {
    collection.standardsTimeline = msg.standardsTimeline;
  }

  if (msg.updateContractAddressTimeline) {
    collection.contractAddressTimeline = msg.contractAddressTimeline;
  }

  if (msg.updateIsArchivedTimeline) {
    collection.isArchivedTimeline = msg.isArchivedTimeline;
  }

  await handleMerkleChallenges(docs, collection, status);

  status.nextCollectionId++;






  docs.refreshes[collection.collectionId.toString()] = {
    _id: collection.collectionId.toString(),
    _rev: '',
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp,
  }
}