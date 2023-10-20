import { MsgCreateAddressMappings } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { pushAddressMappingFetchToQueue } from "../queue"

export const handleMsgCreateAddressMappings = async (msg: MsgCreateAddressMappings, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], [], []); //Note we don't fetch mapping here because if tx was successful, it is a new mapping with unique ID
  await handleNewAccountByAddress(msg.creator, docs);

  const entropy = status.block.height.toString() + "-" + status.block.txIndex.toString();

  for (const addressMapping of msg.addressMappings) {
    if (addressMapping.uri) {
      await pushAddressMappingFetchToQueue(docs, addressMapping, status.block.timestamp, entropy);
    }


    docs.addressMappings[`${addressMapping.mappingId}`] = {
      _id: `${addressMapping.mappingId}`,
      _rev: undefined,
      ...addressMapping,
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