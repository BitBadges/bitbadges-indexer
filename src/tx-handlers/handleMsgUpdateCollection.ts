import { MsgUpdateCollection } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc, addBalances } from "bitbadgesjs-utils"
import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleMerkleChallenges } from "./approvalInfo"

import { pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../queue"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { OFF_CHAIN_URLS_DB, insertToDB } from "../db/db"
import { catch404 } from "../utils/couchdb-utils"

export function recursivelyDeleteFalseProperties(obj: object) {
  if (Array.isArray(obj)) {
    obj.forEach(item => recursivelyDeleteFalseProperties(item));
    return;
  }


  if (typeof obj !== 'object' || obj === null) {
    return;
  }

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const prop = obj[key];

      if (prop && typeof prop === 'object') {
        recursivelyDeleteFalseProperties(prop);

        if (
          prop.hasOwnProperty('invertDefault') ||
          prop.hasOwnProperty('allValues') ||
          prop.hasOwnProperty('noValues')
        ) {
          if (
            !prop.invertDefault &&
            !prop.allValues &&
            !prop.noValues
          ) {
            delete obj[key];
          }
        }
      }
    }
  }
}


export const handleMsgUpdateCollection = async (msg: MsgUpdateCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  recursivelyDeleteFalseProperties(msg);

  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], [], []);
  await handleNewAccountByAddress(msg.creator, docs);


  let collectionId = BigInt(msg.collectionId);
  if (msg.collectionId == 0n) {
    collectionId = status.nextCollectionId;

    docs.collections[status.nextCollectionId.toString()] = {
      _id: status.nextCollectionId.toString(),
      _rev: undefined,
      collectionId: status.nextCollectionId,
      // inheritedCollectionId: msg.inheritedCollectionId,

      managerTimeline: [{
        manager: msg.creator,
        //Go Max Uint 64
        timelineTimes: [{ start: 1n, end: BigInt("18446744073709551615") }],
      }],
      createdBlock: status.block.height,
      createdTimestamp: status.block.timestamp,
      defaultUserIncomingApprovals: msg.defaultIncomingApprovals ?? [],
      defaultUserOutgoingApprovals: msg.defaultOutgoingApprovals ?? [],
      defaultUserPermissions: msg.defaultUserPermissions ?? {
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: [],
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
      },
      defaultAutoApproveSelfInitiatedIncomingTransfers: msg.defaultAutoApproveSelfInitiatedIncomingTransfers ?? false,
      defaultAutoApproveSelfInitiatedOutgoingTransfers: msg.defaultAutoApproveSelfInitiatedOutgoingTransfers ?? false,
      createdBy: msg.creator,
      balancesType: msg.balancesType as "Standard" | "Inherited" | "Off-Chain",
      collectionApprovals: [],
      collectionMetadataTimeline: [],
      badgeMetadataTimeline: [],
      offChainBalancesMetadataTimeline: [],
      customDataTimeline: [],
      standardsTimeline: [],
      contractAddressTimeline: [],
      isArchivedTimeline: [],
      collectionPermissions: {
        canUpdateCollectionMetadata: [],
        canArchiveCollection: [],
        canUpdateBadgeMetadata: [],
        canCreateMoreBadges: [],
        canDeleteCollection: [],
        canUpdateCollectionApprovals: [],
        canUpdateContractAddress: [],
        canUpdateCustomData: [],
        canUpdateManager: [],
        canUpdateOffChainBalancesMetadata: [],
        canUpdateStandards: [],
      },
      updateHistory: [],
    }

    if (msg.balancesType === "Standard" || msg.balancesType === "Off-Chain") {
      docs.balances[`${status.nextCollectionId}:Total`] = {
        _id: `${status.nextCollectionId.toString()}:Total`,
        _rev: undefined,
        balances: [],
        cosmosAddress: "Total",
        collectionId: status.nextCollectionId,
        onChain: true,
        outgoingApprovals: [],
        incomingApprovals: [],
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        userPermissions: {
          canUpdateIncomingApprovals: [],
          canUpdateOutgoingApprovals: [],
          canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
          canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        },
        updateHistory: [],
      }

      docs.balances[`${status.nextCollectionId}:Mint`] = {
        _id: `${status.nextCollectionId.toString()}:Mint`,
        _rev: undefined,
        balances: [],
        cosmosAddress: "Mint",
        collectionId: status.nextCollectionId,
        onChain: true,
        outgoingApprovals: [],
        incomingApprovals: [],
        autoApproveSelfInitiatedIncomingTransfers: false,
        autoApproveSelfInitiatedOutgoingTransfers: false,
        userPermissions: {
          canUpdateIncomingApprovals: [],
          canUpdateOutgoingApprovals: [],
          canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
          canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        },
        updateHistory: [],
      }
    }
  } else {
    await fetchDocsForCacheIfEmpty(docs, [], [collectionId], [
      `${collectionId}:Total`,
      `${collectionId}:Mint`,
    ], [], [], [], []);
  }
  const collection = docs.collections[collectionId.toString()];
  if (!collection) throw new Error(`Collection ${collectionId} does not exist`);

  collection.updateHistory.push({
    block: status.block.height,
    blockTimestamp: status.block.timestamp,
    txHash: txHash,
  })

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
    collection.collectionPermissions = msg.collectionPermissions ?? {
      canUpdateCollectionMetadata: [],
      canArchiveCollection: [],
      canUpdateBadgeMetadata: [],
      canCreateMoreBadges: [],
      canDeleteCollection: [],
      canUpdateCollectionApprovals: [],
      canUpdateContractAddress: [],
      canUpdateCustomData: [],
      canUpdateManager: [],
      canUpdateOffChainBalancesMetadata: [],
      canUpdateStandards: [],
    }
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

  if (msg.updateCollectionMetadataTimeline || msg.updateBadgeMetadataTimeline) {
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

  if (msg.updateContractAddressTimeline) {
    collection.contractAddressTimeline = msg.contractAddressTimeline ?? [];
  }

  if (msg.updateIsArchivedTimeline) {
    collection.isArchivedTimeline = msg.isArchivedTimeline ?? [];
  }

  await handleMerkleChallenges(docs, collection, status);



  docs.refreshes[collection.collectionId.toString()] = {
    _id: collection.collectionId.toString(),
    _rev: undefined,
    collectionId: collection.collectionId,
    refreshRequestTime: status.block.timestamp,
  }

  if (msg.collectionId == 0n) {
    status.nextCollectionId++;
  }

  //TODO: handle in docs cache
  if (collection.offChainBalancesMetadataTimeline.length > 0 && collection.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.startsWith('https://bitbadges.nyc3.digitaloceanspaces.com/balances/')) {
    const uri = collection.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri;
    const customData = collection.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.customData;
    if (customData && uri.split('/').pop() === customData) {
      //BitBadges hosted on DigitalOcean
      //First collection to use the unique code will be the "owner" collection. Determined via on-chain order. Simply first to use a unique string
      //If there is an existing doc, we do not need to do anything. This also protects against other collections simply using the balances URL of another collection (allowed but they won't be able to edit)
      const existingDoc = await OFF_CHAIN_URLS_DB.get(customData).catch(catch404);
      if (!existingDoc) {
        await insertToDB(OFF_CHAIN_URLS_DB, { collectionId: collection.collectionId, _id: customData, _rev: undefined });
      }
    }
  }
}