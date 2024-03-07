import { Balance, BigIntify, CollectionDoc, UserPermissions, type iCollectionDoc, type NumberType } from 'bitbadgesjs-sdk';
import { type BadgeCollection } from 'bitbadgesjs-sdk/dist/proto/badges/collections_pb';
import mongoose from 'mongoose';
import { getFromDB } from '../db/db';
import { AccountModel, AddressListModel, ApprovalTrackerModel, BalanceModel, CollectionModel, MerkleChallengeModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { client, server } from '../indexer';
import { connectToRpc } from '../poll';

// This file simply brute forces all the data in the DB and compares it to the data on the blockchain to ensure consistency
// This is a very slow test and should only be run when necessary

// set env vars to false

describe('queryClient', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'true';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';
    await connectToRpc();

    console.log('queryClient ready');
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(console.error);
    // shut down server
    server?.close();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('all collections should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    const status = await getStatus();

    const maxCollectionId = status.nextCollectionId - 1n;

    for (let i = 1; i <= maxCollectionId; i++) {
      const collectionDoc = await getFromDB(CollectionModel, i.toString());
      if (!collectionDoc) continue; // probably deleted

      const collectionRes = (await queryClient.badges.getCollection(i.toString())) as Required<BadgeCollection> | undefined;
      expect(collectionRes).toBeDefined();
      if (!collectionRes) continue; // For TS

      const bigIntifiedCollectionRes = new CollectionDoc<NumberType>({
        ...collectionRes,
        _docId: i.toString(),
        createdBlock: '0',
        createdTimestamp: '0',
        updateHistory: []
      } as iCollectionDoc<string>).convert(BigIntify);

      for (const key of Object.keys(collectionRes)) {
        expect(JSON.stringify(collectionDoc[key as keyof typeof collectionDoc])).toEqual(
          JSON.stringify(bigIntifiedCollectionRes[key as keyof typeof bigIntifiedCollectionRes])
        );
      }
    }
  });

  it('all accounts should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    // iterate through all AccountModel
    const allAccounts = await AccountModel.find({}).lean().exec();

    for (const indexedAccount of allAccounts) {
      const accountRes = await queryClient.badges.getAccountInfo(indexedAccount.cosmosAddress);
      expect(accountRes).toBeDefined();
      if (!accountRes) continue; // For TS

      if (indexedAccount.accountNumber) {
        expect(accountRes.accountNumber).toEqual(indexedAccount.accountNumber.toString());
      }
    }
  });

  it('all balances should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    const allBalances = await BalanceModel.find({
      onChain: true
    })
      .lean()
      .exec();

    for (const indexedBalance of allBalances) {
      if (indexedBalance.cosmosAddress === 'Total') continue;

      const balanceRes = await queryClient.badges.getBalance(indexedBalance.collectionId.toString(), indexedBalance.cosmosAddress);

      expect(balanceRes).toBeDefined();
      if (!balanceRes) continue; // For TS

      const balances = balanceRes.balances;
      // const incomingApprovals = balanceRes.incomingApprovals ?? []
      // const outgoingApprovals = balanceRes.outgoingApprovals ?? []
      const autoApproveSelfInitiatedIncomingTransfers = balanceRes.autoApproveSelfInitiatedIncomingTransfers ?? false;
      const autoApproveSelfInitiatedOutgoingTransfers = balanceRes.autoApproveSelfInitiatedOutgoingTransfers ?? false;
      const userPermissions = balanceRes.userPermissions;

      expect(balances.map((x) => new Balance(x).convert(BigIntify))).toEqual(indexedBalance.balances.map((x) => new Balance(x).convert(BigIntify)));
      if (userPermissions) {
        console.log(userPermissions);
        expect(UserPermissions.fromProto(userPermissions, BigIntify).equals(new UserPermissions(indexedBalance.userPermissions), true)).toBeTruthy();
      }

      // I think there is some place where we just don't set the autoApprove for Mint but this doesn't really matter
      if (indexedBalance.cosmosAddress !== 'Mint') {
        expect(autoApproveSelfInitiatedIncomingTransfers).toEqual(indexedBalance.autoApproveSelfInitiatedIncomingTransfers ?? false);
        expect(autoApproveSelfInitiatedOutgoingTransfers).toEqual(indexedBalance.autoApproveSelfInitiatedOutgoingTransfers ?? false);

        // TODO:
        // expect(incomingApprovals.map(x => convertUserIncomingApproval({
        //   ...x,
        //   approvalCriteria: undefined // TODO:
        // }, BigIntify))).toEqual(

        //   indexedBalance.incomingApprovals.map(x => convertUserIncomingApproval({
        //   ...x,
        //   approvalCriteria: undefined // TODO:
        // }, BigIntify)))

        // expect(outgoingApprovals.map(x => convertUserOutgoingApproval({
        //   ...x,
        //   approvalCriteria: undefined // TODO:
        // }, BigIntify))).toEqual(indexedBalance.outgoingApprovals.map(x => convertUserOutgoingApproval({
        //   ...x,
        //   approvalCriteria: undefined // TODO:
        // }, BigIntify)))
      }
    }
  });

  it('all challenges should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    const allChallenges = await MerkleChallengeModel.find({}).lean().exec();

    for (const indexedChallenge of allChallenges) {
      for (const leafIndex of indexedChallenge.usedLeafIndices) {
        console.log(indexedChallenge);

        const challengeRes = await queryClient.badges.getChallengeTracker(
          indexedChallenge.collectionId.toString(),
          indexedChallenge.challengeLevel,
          indexedChallenge.approverAddress,
          indexedChallenge.challengeId,
          leafIndex.toString()
        );

        expect(challengeRes).toBeDefined();
        if (!challengeRes) continue; // For TS

        const bigIntifiedChallengeRes = BigInt(challengeRes);
        expect(bigIntifiedChallengeRes).toBeGreaterThan(0n);
      }

      // Check something not used
      const challengeRes = await queryClient.badges.getChallengeTracker(
        indexedChallenge.collectionId.toString(),
        indexedChallenge.challengeLevel,
        indexedChallenge.approverAddress,
        indexedChallenge.challengeId,
        '10000000000000000000000'
      );
      expect(challengeRes).toBeDefined();
      if (!challengeRes) continue; // For TS

      const bigIntifiedChallengeRes = BigInt(challengeRes);
      expect(bigIntifiedChallengeRes).toEqual(0n);
    }
  });

  it('all address lists should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    const allAddressLists = await AddressListModel.find({
      _docId: {
        $regex: /^[^_]+$/
      }
    })
      .lean()
      .exec();

    for (const indexedAddressList of allAddressLists) {
      console.log(indexedAddressList.listId);
      const addressListRes = await queryClient.badges.getAddressList(indexedAddressList.listId);
      expect(addressListRes).toBeDefined();
      if (!addressListRes) continue; // For TS

      for (const key of Object.keys(addressListRes)) {
        expect(JSON.stringify(addressListRes[key as keyof typeof addressListRes])).toEqual(
          JSON.stringify(indexedAddressList[key as keyof typeof indexedAddressList])
        );
      }
    }
  });

  it('all approvals trackers should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error('queryClient not ready');

    const allApprovalTrackers = await ApprovalTrackerModel.find({}).lean().exec();

    for (const indexedApprovalTracker of allApprovalTrackers) {
      const approvalTrackerRes = await queryClient.badges.getApprovalTracker(
        indexedApprovalTracker.collectionId.toString(),
        indexedApprovalTracker.approvalLevel,
        indexedApprovalTracker.approverAddress,
        indexedApprovalTracker.amountTrackerId,
        indexedApprovalTracker.trackerType,
        indexedApprovalTracker.approvedAddress
      );
      expect(approvalTrackerRes).toBeDefined();
      if (!approvalTrackerRes) continue; // For TS

      expect(approvalTrackerRes.numTransfers).toEqual(JSON.stringify(indexedApprovalTracker.numTransfers));
      expect(approvalTrackerRes.amounts.map((x) => new Balance(x).convert(BigIntify))).toEqual(
        indexedApprovalTracker.amounts.map((x) => new Balance(x).convert(BigIntify))
      );
    }
  });
});
