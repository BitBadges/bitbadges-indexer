import { MessageMsgClaimBadge } from "bitbadgesjs-transactions"
import { ActivityItem, ClaimDocument, DbStatus, DocsCache, addBalancesForIdRanges, getBalancesAfterTransfers } from "bitbadgesjs-utils"
import nano from "nano"
import { fetchDocsForRequestIfEmpty } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgClaimBadge = async (msg: MessageMsgClaimBadge, status: DbStatus, docs: DocsCache): Promise<void> => {
  const solutions = msg.solutions ? msg.solutions : [];
  const claimIdString = `${msg.collectionId}:${msg.claimId}`

  //Fetch required docs if needed
  await fetchDocsForRequestIfEmpty(docs, [msg.creator], [msg.collectionId], [], [], [`${msg.collectionId}:${msg.claimId}`]);
  await handleNewAccountByAddress(msg.creator, docs);

  const toAddress = msg.creator;
  await fetchDocsForRequestIfEmpty(docs, [], [], [], [`${msg.collectionId}:${toAddress}`], []);

  //Safe to cast because if MsgClaimBadge Tx is valid, then the claim must exist
  const currClaimObj = docs.claims[claimIdString] as ClaimDocument & nano.DocumentGetResponse;

  //Update for all challenge solutions
  for (let i = 0; i < solutions.length; i++) {
    const solution = solutions[i];
    const challenge = currClaimObj.challenges[i];
    const proof = solution.proof;
    const aunts = proof.aunts;

    //Calculate leaf index
    let leafIndex = BigInt(1);
    for (let i = aunts.length - 1; i >= 0; i--) {
      let aunt = aunts[i];
      let onRight = aunt.onRight;

      if (onRight) {
        leafIndex *= BigInt(2);
      } else {
        leafIndex = leafIndex * BigInt(2) + BigInt(1);
      }
    }

    //Add to used leaf indices
    challenge.usedLeafIndices.push(leafIndex);
  }


  const balancesTransferred = JSON.parse(JSON.stringify(currClaimObj.currentClaimAmounts));



  //Add claim activity item
  docs.activityToAdd.push({
    partition: `collection-${msg.collectionId}`,
    from: ['Mint'],
    to: [toAddress],
    balances: balancesTransferred,
    collectionId: msg.collectionId,
    method: 'Claim',
    block: status.block.height,
    timestamp: BigInt(Date.now()),
  } as ActivityItem);


  //Update the balances doc of the toAddress
  const toCosmosAddress = msg.creator;
  let toAddressBalanceDoc = docs.balances[`${msg.collectionId}:${toCosmosAddress}`];
  for (const balance of balancesTransferred) {
    toAddressBalanceDoc = {
      ...toAddressBalanceDoc,
      ...addBalancesForIdRanges(toAddressBalanceDoc, balance.badgeIds, balance.balance)
    }
  }

  const newClaimBalances = getBalancesAfterTransfers(
    currClaimObj.undistributedBalances,
    [{
      toAddresses: [toAddress],
      balances: currClaimObj.currentClaimAmounts
    }]
  );

  currClaimObj.currentClaimAmounts = newClaimBalances;

  //Increment badgeIDs
  if (currClaimObj.incrementIdsBy) {
    for (const balance of currClaimObj.currentClaimAmounts) {
      for (let i = 0; i < balance.badgeIds.length; i++) {
        balance.badgeIds[i].start += currClaimObj.incrementIdsBy;
        balance.badgeIds[i].end += currClaimObj.incrementIdsBy;
      }
    }
  }

  currClaimObj.totalClaimsProcessed++;
  currClaimObj.claimsPerAddressCount[toAddress] = currClaimObj.claimsPerAddressCount[toAddress] ? currClaimObj.claimsPerAddressCount[toAddress] + 1n : 1n;

  docs.claims[claimIdString] = currClaimObj;
}