import { MsgSetApproval } from "bitbadgesjs-transactions"
import { fetchDocsForCacheIfEmpty } from "../db/cache"

import { StatusDoc, DocsCache } from "bitbadgesjs-utils";
import { Approval } from "bitbadgesjs-proto";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgSetApproval = async (msg: MsgSetApproval<bigint>, status: StatusDoc<bigint>, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [`${msg.collectionId}:${msg.creator}`], []);
  await handleNewAccountByAddress(msg.creator, docs);


  let balanceDoc = docs.balances[`${msg.collectionId}:${msg.creator}`];

  const approvals = balanceDoc.approvals.filter((approval: Approval<bigint>) => approval.address !== msg.address);
  approvals.push({ address: msg.address, balances: msg.balances });
  //Sort approvals by address alphabetically
  approvals.sort((a: Approval<bigint>, b: Approval<bigint>) => a.address.localeCompare(b.address));

  balanceDoc = {
    ...balanceDoc,
    balances: balanceDoc.balances,
    approvals: approvals,
    cosmosAddress: msg.creator
  }
}