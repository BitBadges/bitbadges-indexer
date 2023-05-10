import { MessageMsgUpdateUris } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { pushToMetadataQueue } from "../metadata-queue"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { CollectionDocument, DbStatus, DocsCache } from "bitbadgesjs-utils";
import nano from "nano";

export const handleMsgUpdateUris = async (msg: MessageMsgUpdateUris, status: DbStatus, docs: DocsCache): Promise<void> => {
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], []);

  //Safe to cast because Msg can only be called if the collection exists
  const collection = docs.collections[msg.collectionId] as CollectionDocument & nano.DocumentGetResponse;


  //Only update the URIs if the collectionUri or badgeUris were specified and changed
  let updateCollectionMetadata = false;
  let updateBadgeMetadata = false;
  if (msg.collectionUri != "" && msg.collectionUri != collection.collectionUri) {
    updateCollectionMetadata = true;
  }
  if (msg.badgeUris && msg.badgeUris.length > 0) {
    updateBadgeMetadata = true;
  }

  collection.collectionUri = msg.collectionUri;
  collection.badgeUris = msg.badgeUris;

  //Add to the refresh metadata queue
  if (updateCollectionMetadata && !updateBadgeMetadata) {
    await pushToMetadataQueue(collection, status, "collection"); //Update only collection
  } else {
    //TODO: Optimize this to check metadataIds and avoid redundant updates
    await pushToMetadataQueue(collection, status);
  }
}