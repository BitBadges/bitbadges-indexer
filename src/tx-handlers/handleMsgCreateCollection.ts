import { type MsgCreateCollection, type StatusDoc, MsgUniversalUpdateCollection } from 'bitbadgesjs-sdk';
import { handleMsgUniversalUpdateCollection } from './handleMsgUniversalUpdateCollection';
import { type DocsCache } from '../db/types';

export const handleMsgCreateCollection = async (
  msg: MsgCreateCollection<bigint>,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  txHash: string
): Promise<void> => {
  await handleMsgUniversalUpdateCollection(
    new MsgUniversalUpdateCollection<bigint>({
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
      updateStandardsTimeline: true
    }),
    status,
    docs,
    txHash
  );
};
