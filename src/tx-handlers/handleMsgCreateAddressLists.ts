import { MsgCreateAddressLists } from "bitbadgesjs-sdk"
import { DocsCache, StatusDoc } from "bitbadgesjs-sdk"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { pushAddressListFetchToQueue } from "../queue"
import { client } from "../indexer"

export const handleMsgCreateAddressLists = async (msg: MsgCreateAddressLists, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], [], [], [], []); //Note we don't fetch list here because if tx was successful, it is a new list with unique ID
  await handleNewAccountByAddress(msg.creator, docs);

  const entropy = status.block.height.toString() + "-" + status.block.txIndex.toString();

  for (const addressList of msg.addressLists) {
    if (addressList.uri) {
      await pushAddressListFetchToQueue(docs, addressList, status.block.timestamp, entropy);
    }
    //TODO: Do this natively?
    const addressListRes = await client.badgesQueryClient?.badges.getAddressList(addressList.listId);
    if (!addressListRes) throw new Error(`Address list ${addressList.listId} does not exist`);

    docs.addressLists[`${addressList.listId}`] = {
      _docId: `${addressList.listId}`,

      ...addressList,
      aliasAddress: addressListRes.aliasAddress,
      createdBlock: status.block.height,
      lastUpdated: status.block.timestamp,
      createdBy: msg.creator,
      updateHistory: [{
        block: status.block.height,
        blockTimestamp: status.block.timestamp,
        txHash: txHash,
      }],
    };
  }
}