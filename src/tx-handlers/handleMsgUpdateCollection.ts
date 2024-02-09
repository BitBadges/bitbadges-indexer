import { MsgUpdateCollection } from "bitbadgesjs-sdk";
import { DocsCache, StatusDoc } from "bitbadgesjs-sdk";
import { handleMsgUniversalUpdateCollection } from "./handleMsgUniversalUpdateCollection";

export const handleMsgUpdateCollection = async (msg: MsgUpdateCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  const res = await handleMsgUniversalUpdateCollection({
    ...msg,
  }, status, docs, txHash);
  return res;
}