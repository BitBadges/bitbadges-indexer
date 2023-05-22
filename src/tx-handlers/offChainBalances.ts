import { BalancesMap, Collection, DocsCache } from "bitbadgesjs-utils";
import { fetchUri } from "../metadata-queue";
import { fetchDocsForRequestIfEmpty } from "../db/db";

export const updateBalancesForOffChainBalances = async (collection: Collection, docs: DocsCache, isNewCollection: boolean): Promise<void> => {
  let balanceMap: BalancesMap = {};
  if (collection.balancesUri) {
    try {
      balanceMap = await fetchUri(collection.balancesUri);
    } catch (e) {

    }
  }

  //We have to update the existing balances with the new balances, if the collection already exists
  //This is a complete overwrite of the balances (i.e. we fetch all the balances from the balancesUri and overwrite the existing balances)

  //TODO: This could be a scalability bottleneck with many documents
  //IDEA: We could take all balance document updates out of the poller logic and put it in a separate scalable queue
  //Similar to accounts, this can only be updated by one entity (the manager) so data races should not be an issue
  if (!isNewCollection) {
    await fetchDocsForRequestIfEmpty(docs, [], [], [], [
      ...Object.keys(balanceMap).map((key) => `${collection.collectionId}:${key}`),
    ], []);
  }

  //Update the balance documents
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