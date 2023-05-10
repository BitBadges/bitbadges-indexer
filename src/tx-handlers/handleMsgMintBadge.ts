import { MessageMsgMintBadge } from "bitbadgesjs-transactions"
import { BitBadgesUserInfo, CollectionDocument, DbStatus, DocsCache, Metadata, MetadataMap, simulateCollectionAfterMsgMintBadge } from "bitbadgesjs-utils"
import { CLAIMS_DB, fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { handleClaims } from "./claims"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { handleTransfers } from "./handleTransfers"
import nano from "nano"

export const handleMsgMintBadge = async (msg: MessageMsgMintBadge, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because MsgMintBadge can only be called if the collection exists
  const collectionDoc = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;

  /**
   * Honestly, this is pretty overkill. We really just use this function to calculate the updated collection's
   * collectionUri, badgeUris, unmintedSupplys, maxSupplys and nextBadgeId.
   *
   * The only necessary inputs to calculate this is the collectionId, creator, badgeSupplys, collectionUri, and badgeUris 
   * which are all provided in msg. See the function for more details.
   *
   * Note we handle transfers, claims, and balances separately below. The returned collection object is not used for these.
   * 
   * All other types are not used in this simulation (just set to default for TypeScript)
   */
  const collection = simulateCollectionAfterMsgMintBadge(
    msg,
    {} as Metadata,
    {} as MetadataMap,
    {} as BitBadgesUserInfo,
    [],
    {
      ...collectionDoc,
      claims: [],
      activity: [],
      announcements: [],
      reviews: [],
      balances: [],
      managerInfo: {} as BitBadgesUserInfo,
      collectionMetadata: {} as Metadata,
      badgeMetadata: {} as MetadataMap,
    },
  );


  //Only update the URIs if the collectionUri or badgeUris were specified and changed
  let newCollectionUri = collection.collectionUri;
  let updateCollectionMetadata = false;
  let newBadgeUris = collection.badgeUris;
  let updateBadgeMetadata = false;
  if (msg.collectionUri != "" && msg.collectionUri != collection.collectionUri) {
    newCollectionUri = msg.collectionUri;
    updateCollectionMetadata = true;
  }
  if (msg.badgeUris && msg.badgeUris.length > 0) {
    newBadgeUris = msg.badgeUris;
    updateBadgeMetadata = true;
  }

  //Add to the refresh metadata queue
  if (updateCollectionMetadata && !updateBadgeMetadata) {
    await pushToMetadataQueue(collection, status, "collection"); //Update only collection
  } else {
    //TODO: Optimize this to check metadataIds and avoid redundant updates
    await pushToMetadataQueue(collection, status);
  }

  //Only update the relevant fields in the collection doc that can change
  collectionDoc.collectionUri = newCollectionUri;
  collectionDoc.badgeUris = newBadgeUris;
  collectionDoc.unmintedSupplys = collection.unmintedSupplys;
  collectionDoc.maxSupplys = collection.maxSupplys;
  collectionDoc.nextBadgeId = collection.nextBadgeId;

  const existingClaimsDocs = await CLAIMS_DB.partitionedList(`${collection.collectionId}`); //Fetches head only
  const numExistingClaims = existingClaimsDocs.total_rows;
  await handleClaims(docs, msg.claims, collection.collectionId, numExistingClaims);

  await handleTransfers(collection, ['Mint'], msg.transfers, docs, status);
}