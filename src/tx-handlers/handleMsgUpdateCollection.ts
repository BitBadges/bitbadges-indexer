import { type MsgUpdateCollection, type StatusDoc, MsgUniversalUpdateCollection } from 'bitbadgesjs-sdk';
import { handleMsgUniversalUpdateCollection } from './handleMsgUniversalUpdateCollection';
import { type DocsCache } from '../db/types';

export const handleMsgUpdateCollection = async (
  msg: MsgUpdateCollection<bigint>,
  status: StatusDoc<bigint>,
  docs: DocsCache,
  txHash: string
): Promise<void> => {
  const msgParam = new MsgUniversalUpdateCollection<bigint>({ ...msg });
  await handleMsgUniversalUpdateCollection(msgParam, status, docs, txHash);
};
