import { MessageMsgSetApproval } from "bitbadgesjs-transactions"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"
import { DbStatus, DocsCache } from "bitbadgesjs-utils";
import { Approval } from "bitbadgesjs-proto";

export const handleMsgSetApproval = async (msg: MessageMsgSetApproval, status: DbStatus, docs: DocsCache): Promise<void> => {
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [`${msg.collectionId}:${msg.creator}`], []);
  await handleNewAccountByAddress(msg.creator, docs);


  let balanceDoc = docs.balances[`${msg.collectionId}:${msg.creator}`];

  const approvals = balanceDoc.approvals.filter((approval: Approval) => approval.address !== msg.address);
  approvals.push({ address: msg.address, balances: msg.balances });
  approvals.sort((a: Approval, b: Approval) => Number(a.address) - Number(b.address));

  balanceDoc = {
    ...balanceDoc,
    balances: balanceDoc.balances,
    approvals: approvals,
    cosmosAddress: msg.creator
  }
}