import { MsgCreateCollection } from "bitbadgesjs-sdk";
import { DocsCache, StatusDoc } from "bitbadgesjs-sdk";
import { handleMsgUniversalUpdateCollection } from "./handleMsgUniversalUpdateCollection";

export const handleMsgCreateCollection = async (msg: MsgCreateCollection<bigint>, status: StatusDoc<bigint>, docs: DocsCache, txHash: string): Promise<void> => {
  const res = await handleMsgUniversalUpdateCollection({
    ...msg,
    collectionId: 0n,
    updateBadgeMetadataTimeline: true,
    updateCollectionApprovals: true,
    updateCollectionMetadataTimeline: true,
    updateCollectionPermissions: true,
    updateCustomDataTimeline: true,
    updateIsArchivedTimeline: true,
    updateManagerTimeline: true,
    updateOffChainBalancesMetadataTimeline: true,
    updateStandardsTimeline: true,
  }, status, docs, txHash);
  return res;
}