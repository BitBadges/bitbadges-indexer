import { MsgCreateAddressMappings } from "bitbadgesjs-proto"
import { DocsCache, StatusDoc } from "bitbadgesjs-utils"

import { fetchDocsForCacheIfEmpty } from "../db/cache"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgCreateAddressMappings = async (msg: MsgCreateAddressMappings, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [], [], [], [], []); //Note we don't fetch mapping here because if tx was successful, it is a new mapping with unique ID
  await handleNewAccountByAddress(msg.creator, docs);

  for (const addressMapping of msg.addressMappings) {
    docs.addressMappings[`${addressMapping.mappingId}`] = {
      _id: `${addressMapping.mappingId}`,
      _rev: undefined,
      ...addressMapping,
      createdBy: msg.creator,
    };
  }
}