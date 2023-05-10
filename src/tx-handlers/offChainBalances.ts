import { BalancesMap, CollectionDocument, DocsCache } from "bitbadgesjs-utils";
import { fetchUri } from "../metadata-queue";
import { fetchDocsForRequestIfEmpty } from "../db/db";

export const updateBalancesForOffChainBalances = async (collection: CollectionDocument, docs: DocsCache, isNewCollection: boolean): Promise<void> => {
  let balanceMap: BalancesMap = {}
  if (collection.standard === 1) {
    try {
      if (!collection.bytes) {
        return;
      }

      balanceMap = await fetchUri(collection.bytes);
    } catch (e) {

    }
  }

  //We have to update the existing balances with the new balances, if the collection already exists
  if (!isNewCollection) {
    await fetchDocsForRequestIfEmpty(docs, [], [], [], [
      ...Object.keys(balanceMap).map((key) => `${collection.collectionId}:${key}`),
    ], []);
  }

  for (const [key, val] of Object.entries(balanceMap)) {
    docs.balances[`${collection.collectionId}:${key}`] = {
      ...docs.balances[`${collection.collectionId}:${key}`],
      _id: docs.balances[`${collection.collectionId}:${key}`]._id,
      ...val,
      collectionId: collection.collectionId,
      cosmosAddress: key,
    };
  }
}