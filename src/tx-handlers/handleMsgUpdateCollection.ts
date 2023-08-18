import { MsgUpdateCollection } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc, addBalances } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleMerkleChallenges } from "./merkleChallenges"

import { pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../metadata-queue"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgUpdateCollection = async (msg: MsgUpdateCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);


  let collectionId = BigInt(msg.collectionId);
  if (msg.collectionId == 0n) {
    collectionId = status.nextCollectionId;

    docs.collections[status.nextCollectionId.toString()] = {
      _id: status.nextCollectionId.toString(),
      _rev: undefined,
      collectionId: status.nextCollectionId,

      managerTimeline: [{
        manager: msg.creator,
        //Go Max Uint 64
        timelineTimes: [{ start: 1n, end: BigInt("18446744073709551615") }],
      }],
      createdBlock: status.block.height,
      createdTimestamp: status.block.timestamp,
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
      _rev: undefined,
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
      _rev: undefined,
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
    await fetchDocsForCacheIfEmpty(docs, [], [collectionId], [
      `${collectionId}:Total`,
      `${collectionId}:Mint`,
    ], [], [], []);
  }
  const collection = docs.collections[collectionId.toString()];
  if (!collection) throw new Error(`Collection ${collectionId} does not exist`);

  const totalBalance = docs.balances[`${collectionId}:Total`];
  if (!totalBalance) throw new Error(`Total balance for collection ${collectionId} does not exist`);

  const mintBalance = docs.balances[`${collectionId}:Mint`];
  if (!mintBalance) throw new Error(`Mint balance for collection ${collectionId} does not exist`);

  if (msg.badgesToCreate && msg.badgesToCreate.length > 0) {
    totalBalance.balances = addBalances(msg.badgesToCreate, totalBalance.balances);
    mintBalance.balances = addBalances(msg.badgesToCreate, mintBalance.balances);
  }

  const entropy = status.block.height.toString() + "-" + status.block.txIndex.toString();

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
    await pushCollectionFetchToQueue(docs, collection, status.block.timestamp, entropy);
  }

  if (msg.updateOffChainBalancesMetadataTimeline) {
    collection.offChainBalancesMetadataTimeline = msg.offChainBalancesMetadataTimeline;
    await pushBalancesFetchToQueue(docs, collection, status.block.timestamp, entropy);
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
    _rev: undefined,
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp,
  }
}