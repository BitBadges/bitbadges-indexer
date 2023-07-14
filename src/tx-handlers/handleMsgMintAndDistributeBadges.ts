import { MsgMintAndDistributeBadges } from "bitbadgesjs-transactions"
import { BadgeMetadataDetails, BitBadgesUserInfo, DocsCache, Metadata, StatusDoc, simulateCollectionAfterMsg } from "bitbadgesjs-utils"
import { CLAIMS_DB } from "../db/db"
import { handleClaims } from "./claims"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { getBalancesIdForQueueDb, getCollectionIdForQueueDb, pushBalancesFetchToQueue, pushCollectionFetchToQueue } from "../metadata-queue"
import { getLoadBalancerId } from "../utils/loadBalancer"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"

export const handleMsgMintAndDistributeBadges = async (msg: MsgMintAndDistributeBadges<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], []);
  await handleNewAccountByAddress(msg.creator, docs);

  //Safe to cast because MsgMintBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId.toString()];
  if (!collectionDoc) throw new Error(`Collection ${msg.collectionId.toString()} does not exist`);

  /**
   * Honestly, this is pretty overkill. We really just use this function to calculate the updated collection's
   * collectionUri, badgeUris, unmintedSupplys, maxSupplys and nextBadgeId.
   *
   * The only necessary inputs to calculate this is the collectionId, creator, badgeSupplys, collectionUri, and badgeUris 
   * which are all provided in msg. See the function for more details.
   *
   * Note we handle claims, and balances separately below. The returned collection object is not used for these.
   *
   * All other types are not used in this simulation (just set to default blank values for TypeScript)
   */
  const collection = simulateCollectionAfterMsg(
    {
      ...collectionDoc,
      claims: [],
      activity: [],
      announcements: [],
      reviews: [],
      owners: [],
      managerInfo: {} as BitBadgesUserInfo<bigint>,
      collectionMetadata: {} as Metadata<bigint>,
      badgeMetadata: [] as BadgeMetadataDetails<bigint>[],
      _rev: undefined,
      _deleted: undefined,
      views: {},
    },
    msg.claims.map((claim, idx) => {
      return {
        ...claim,
        //Values below don't matter. Just need to set them to something.
        claimId: BigInt(idx + 1),
        collectionId: 0n,
        totalClaimsProcessed: 0n,
        claimsPerAddressCount: {},
        usedLeafIndices: [...claim.challenges.map(() => [])],
        usedLeaves: [...claim.challenges.map(() => [])],
        details: undefined,
        _id: ``
      }
    }),
    msg.transfers,
    msg.badgeSupplys
  );


  //Only update the URIs if the collectionUri or badgeUris were specified and changed
  let newCollectionUri = collection.collectionUri;
  let updateCollectionMetadata = false;
  let newBadgeUris = collection.badgeUris;
  let newBalancesUri = collection.balancesUri;
  let updateBalancesUri = false;
  if (msg.collectionUri != "" && msg.collectionUri != collection.collectionUri) {
    newCollectionUri = msg.collectionUri;
    updateCollectionMetadata = true;
  }
  if (msg.badgeUris && msg.badgeUris.length > 0) {
    newBadgeUris = msg.badgeUris;
  }

  if (msg.balancesUri != "" && msg.balancesUri != collection.balancesUri) {
    newBalancesUri = msg.balancesUri;
    updateBalancesUri = true;
  }


  //Only update the relevant fields in the collection doc that can change
  collectionDoc.collectionUri = newCollectionUri;
  collectionDoc.badgeUris = newBadgeUris;
  collectionDoc.balancesUri = newBalancesUri;
  collectionDoc.unmintedSupplys = collection.unmintedSupplys;
  collectionDoc.maxSupplys = collection.maxSupplys;
  collectionDoc.nextBadgeId = collection.nextBadgeId;

  const existingClaimsDocs = await CLAIMS_DB.partitionInfo(`${collection.collectionId.toString()}`); //Fetches head only
  const numExistingClaims = existingClaimsDocs.doc_count;
  await handleClaims(docs, msg.claims, collection.collectionId, numExistingClaims, status);

  await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);

  const entropy = status.block.height + "-" + status.block.txIndex;

  const docId = getCollectionIdForQueueDb(entropy, collection.collectionId.toString());
  if (updateCollectionMetadata) {
    await pushCollectionFetchToQueue(docs, collection, getLoadBalancerId(docId), status.block.timestamp, entropy);
  }

  const balanceDocId = getBalancesIdForQueueDb(entropy, collection.collectionId.toString());
  if (updateBalancesUri) {
    await pushBalancesFetchToQueue(docs, collection, getLoadBalancerId(balanceDocId), status.block.timestamp, entropy);
  }

}