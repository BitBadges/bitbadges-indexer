import { MessageMsgClaimBadge } from "bitbadgesjs-transactions"
import { AccountDocument, ActivityItem, addBalancesForIdRanges, ClaimDocument, DbStatus, DocsCache, getBalanceAfterTransfers } from "bitbadgesjs-utils"
import nano from "nano"
import { fetchDocsForRequestIfEmpty, PASSWORDS_DB } from "../db/db"
import { handleNewAccountByAddress } from "./handleNewAccount"

export const handleMsgClaimBadge = async (msg: MessageMsgClaimBadge, status: DbStatus, docs: DocsCache): Promise<void> => {
  const codeString = msg.codeProof.leaf ? msg.codeProof.leaf : '';
  const addressString = msg.creator ? msg.creator : '';
  const claimIdString = msg.claimId.toString();

  //Fetch required docs if needed
  await handleNewAccountByAddress(msg.creator, docs);
  await fetchDocsForRequestIfEmpty(docs, [], [msg.collectionId], [], [], [claimIdString]);

  //Safe to cast because we handle new accounts above
  const creatorAccountDoc = docs.accounts[msg.creator] as nano.DocumentGetResponse & AccountDocument;

  const toAddress = docs.accountNumbersMap[msg.creator];
  await fetchDocsForRequestIfEmpty(docs, [], [], [], [`${msg.collectionId}:${toAddress}`], []);

  //Safe to cast because if MsgClaimBadge Tx is valid, then the claim must exist
  const currClaimObj = docs.claims[claimIdString] as nano.DocumentGetResponse & ClaimDocument;
  const balancesTransferred = [{
    balance: currClaimObj.amount,
    badgeIds: JSON.parse(JSON.stringify(currClaimObj.badgeIds)),
  }]


  //Add claim activity item
  docs.activityToAdd.push({
    partition: `collection-${msg.collectionId}`,
    from: ['Mint'],
    to: [Number(toAddress)],
    balances: balancesTransferred,
    collectionId: msg.collectionId,
    method: 'Claim',
    block: status.block.height,
    timestamp: Date.now(),
  } as ActivityItem);


  //Update the balances doc of the toAddress
  const toCosmosAddress = creatorAccountDoc.cosmosAddress;

  let toAddressBalanceDoc = docs.balances[`${msg.collectionId}:${toCosmosAddress}`];

  for (const balance of balancesTransferred) {
    toAddressBalanceDoc = {
      ...toAddressBalanceDoc,
      ...addBalancesForIdRanges(toAddressBalanceDoc, balance.badgeIds, balance.balance)
    }
  }

  const newClaimBalance = getBalanceAfterTransfers(
    {
      balances: currClaimObj.balances,
      approvals: [],
    },
    [{
      toAddresses: [toAddress],
      balances: [{
        balance: currClaimObj.amount,
        badgeIds: currClaimObj.badgeIds,
      }],
    }]
  );

  currClaimObj.balances = newClaimBalance.balances;

  //Increment badgeIDs
  if (currClaimObj.incrementIdsBy) {
    for (let i = 0; i < currClaimObj.badgeIds.length; i++) {
      currClaimObj.badgeIds[i].start += currClaimObj.incrementIdsBy;
      currClaimObj.badgeIds[i].end += currClaimObj.incrementIdsBy;
    }
  }

  //If no more balances, all badges have been claimed
  //Attempt to delete unneeded docs (don't care if it fails as it is just a cleanup)
  if (currClaimObj.balances.length == 0) {
    currClaimObj.hashedCodes = [];

    try {
      const query: nano.MangoQuery = {
        selector: {
          collectionId: {
            "$eq": msg.collectionId
          },
          claimId: {
            "$eq": msg.claimId
          }
        }
      }

      const result = await PASSWORDS_DB.find(query);

      if (result.docs.length > 0) {
        const doc = result.docs[0];
        await PASSWORDS_DB.destroy(doc._id, doc._rev);
      }
    } catch (e) { }
  }

  //Update the usedClaims store
  const usedClaims = currClaimObj.usedClaims;
  usedClaims.numUsed = usedClaims.numUsed + 1;
  usedClaims.addresses[addressString] = usedClaims.addresses[addressString] + 1;
  usedClaims.codes[codeString] = currClaimObj.usedClaims.codes[codeString] + 1;

  docs.claims[claimIdString] = currClaimObj;
}