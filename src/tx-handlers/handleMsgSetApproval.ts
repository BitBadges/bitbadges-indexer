import { MessageMsgSetApproval } from "bitbadgesjs-transactions"
import { fetchDocsForCacheIfEmpty } from "../db/db"

import { DbStatus, DocsCache } from "bitbadgesjs-utils";
import { Approval } from "bitbadgesjs-proto";
import { handleNewAccountByAddress } from "./handleNewAccount";

export const handleMsgSetApproval = async (msg: MessageMsgSetApproval, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForCacheIfEmpty(docs, [msg.creator], [msg.collectionId], [], [`${msg.collectionId}:${msg.creator}`], []);
  await handleNewAccountByAddress(msg.creator, docs);


  let balanceDoc = docs.balances[`${msg.collectionId}:${msg.creator}`];

  const approvals = balanceDoc.approvals.filter((approval: Approval) => approval.address !== msg.address);
  approvals.push({ address: msg.address, balances: msg.balances });
  //Sort approvals by address alphabetically
  approvals.sort((a: Approval, b: Approval) => a.address.localeCompare(b.address));

  balanceDoc = {
    ...balanceDoc,
    balances: balanceDoc.balances,
    approvals: approvals,
    cosmosAddress: msg.creator
  }
}