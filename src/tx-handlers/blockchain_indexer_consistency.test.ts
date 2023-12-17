import { convertBalance, convertUserIncomingApproval, convertUserOutgoingApproval, convertUserPermissions } from "bitbadgesjs-proto";
import { BadgeCollection } from "bitbadgesjs-proto/dist/proto/badges/collections_pb";
import { BigIntify, CollectionDoc, NumberType, convertCollectionDoc, convertStatusDoc } from "bitbadgesjs-utils";
import mongoose from "mongoose";
import { AccountModel, AddressMappingModel, ApprovalsTrackerModel, BalanceModel, CollectionModel, MerkleChallengeModel, StatusModel, getFromDB } from "../db/db";
import { client } from "../indexer";
import { connectToRpc } from "../poll";

//This file simply brute forces all the data in the DB and compares it to the data on the blockchain to ensure consistency
//This is a very slow test and should only be run when necessary


describe("queryClient", () => {
  beforeAll(async () => {
    await connectToRpc();

    console.log("queryClient ready");
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("all collections should be indexed correctly", async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    const _status = await StatusModel.findOne({}).lean().exec();
    if (!_status) throw new Error("status not found");
    const status = convertStatusDoc(_status, BigIntify);

    const maxCollectionId = status.nextCollectionId - 1n;

    for (let i = 1; i <= maxCollectionId; i++) {
      const collectionDoc = await getFromDB(CollectionModel, i.toString());
      if (!collectionDoc) continue //probably deleted

      const collectionRes = await queryClient.badges.getCollection(i.toString()) as Required<BadgeCollection> | undefined;
      expect(collectionRes).toBeDefined();
      if (!collectionRes) continue; //For TS


      const bigIntifiedCollectionDoc = convertCollectionDoc(collectionDoc, BigIntify);
      const bigIntifiedCollectionRes = convertCollectionDoc({
        ...collectionRes,
        _legacyId: i.toString(),
        createdBlock: 0n,
        createdTimestamp: 0n,
        updateHistory: [],
      } as CollectionDoc<NumberType>, BigIntify);


      for (const key of Object.keys(collectionRes)) {
        expect(JSON.stringify(bigIntifiedCollectionDoc[key as keyof typeof bigIntifiedCollectionDoc])).toEqual(JSON.stringify(bigIntifiedCollectionRes[key as keyof typeof bigIntifiedCollectionRes]));
      }
    }
  });

  it("all accounts should be indexed correctly", async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    //iterate through all AccountModel 
    const allAccounts = await AccountModel.find({}).lean().exec();


    for (const indexedAccount of allAccounts) {

      const accountRes = await queryClient.badges.getAccountInfo(indexedAccount.cosmosAddress);
      expect(accountRes).toBeDefined();
      if (!accountRes) continue; //For TS

      if (indexedAccount.accountNumber) {
        expect(accountRes.accountNumber).toEqual(indexedAccount.accountNumber.toString());
      }
    }
  });


  it("all balances should be indexed correctly", async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    const allBalances = await BalanceModel.find({
      onChain: true,
    }).lean().exec();

    for (const indexedBalance of allBalances) {
      if (indexedBalance.cosmosAddress === "Total") continue;

      const balanceRes = await queryClient.badges.getBalance(indexedBalance.collectionId.toString(), indexedBalance.cosmosAddress);

      expect(balanceRes).toBeDefined();
      if (!balanceRes) continue; //For TS


      const balances = balanceRes.balances;
      const incomingApprovals = balanceRes.incomingApprovals ?? [];
      const outgoingApprovals = balanceRes.outgoingApprovals ?? [];
      const autoApproveSelfInitiatedIncomingTransfers = balanceRes.autoApproveSelfInitiatedIncomingTransfers ?? false;
      const autoApproveSelfInitiatedOutgoingTransfers = balanceRes.autoApproveSelfInitiatedOutgoingTransfers ?? false;
      const userPermissions = balanceRes.userPermissions;


      expect(balances.map(x => convertBalance(x, BigIntify))).toEqual(indexedBalance.balances.map(x => convertBalance(x, BigIntify)));
      expect(convertUserPermissions({
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: [],
        ...userPermissions,
      }, BigIntify)).toEqual(convertUserPermissions(indexedBalance.userPermissions, BigIntify));

      expect(autoApproveSelfInitiatedIncomingTransfers).toEqual(indexedBalance.autoApproveSelfInitiatedIncomingTransfers ?? false);
      expect(autoApproveSelfInitiatedOutgoingTransfers).toEqual(indexedBalance.autoApproveSelfInitiatedOutgoingTransfers ?? false);

      expect(incomingApprovals.map(x => convertUserIncomingApproval({
        ...x,
        approvalCriteria: undefined, //TODO:
      }, BigIntify))).toEqual(indexedBalance.incomingApprovals.map(x => convertUserIncomingApproval({
        ...x,
        approvalCriteria: undefined, //TODO:
      }, BigIntify)));

      expect(outgoingApprovals.map(x => convertUserOutgoingApproval({
        ...x,
        approvalCriteria: undefined, //TODO:
      }, BigIntify))).toEqual(indexedBalance.outgoingApprovals.map(x => convertUserOutgoingApproval({
        ...x,
        approvalCriteria: undefined, //TODO:
      }, BigIntify)));
    }
  });

  it('all challenges should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    const allChallenges = await MerkleChallengeModel.find({}).lean().exec();

    for (const indexedChallenge of allChallenges) {
      for (const leafIndex of indexedChallenge.usedLeafIndices) {

        const challengeRes = await queryClient.badges.getNumUsedForMerkleChallenge(indexedChallenge.collectionId.toString(), indexedChallenge.challengeLevel, indexedChallenge.approverAddress, indexedChallenge.challengeId, leafIndex.toString());

        expect(challengeRes).toBeDefined();
        if (!challengeRes) continue; //For TS

        const bigIntifiedChallengeRes = BigInt(challengeRes);
        expect(bigIntifiedChallengeRes).toBeGreaterThan(0n);

      }

      //Check something not used 
      const challengeRes = await queryClient.badges.getNumUsedForMerkleChallenge(indexedChallenge.collectionId.toString(), indexedChallenge.challengeLevel, indexedChallenge.approverAddress, indexedChallenge.challengeId, "10000000000000000000000");
      expect(challengeRes).toBeDefined();
      if (!challengeRes) continue; //For TS

      const bigIntifiedChallengeRes = BigInt(challengeRes);
      expect(bigIntifiedChallengeRes).toEqual(0n);
    }
  });

  it('all address mappings should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    const allAddressMappings = await AddressMappingModel.find({
      _legacyId: {
        $regex: /^[^_]+$/,
      },
    }).lean().exec();

    for (const indexedAddressMapping of allAddressMappings) {
      const addressMappingRes = await queryClient.badges.getAddressMapping(indexedAddressMapping.mappingId);
      expect(addressMappingRes).toBeDefined();
      if (!addressMappingRes) continue; //For TS

      for (const key of Object.keys(addressMappingRes)) {
        expect(JSON.stringify(addressMappingRes[key as keyof typeof addressMappingRes])).toEqual(JSON.stringify(indexedAddressMapping[key as keyof typeof indexedAddressMapping]));
      }
    }
  });

  it('all approvals trackers should be indexed correctly', async () => {
    const queryClient = client.badgesQueryClient;
    if (!queryClient) throw new Error("queryClient not ready");

    const allApprovalsTrackers = await ApprovalsTrackerModel.find({}).lean().exec();

    for (const indexedApprovalsTracker of allApprovalsTrackers) {
      const approvalsTrackerRes = await queryClient.badges.getApprovalsTracker(indexedApprovalsTracker.collectionId.toString(), indexedApprovalsTracker.approvalLevel, indexedApprovalsTracker.approverAddress, indexedApprovalsTracker.amountTrackerId, indexedApprovalsTracker.trackerType, indexedApprovalsTracker.approvedAddress);
      expect(approvalsTrackerRes).toBeDefined();
      if (!approvalsTrackerRes) continue; //For TS

      expect(JSON.stringify(approvalsTrackerRes.numTransfers)).toEqual(JSON.stringify(indexedApprovalsTracker.numTransfers));
      expect(approvalsTrackerRes.amounts.map(x => convertBalance(x, BigIntify))).toEqual(indexedApprovalsTracker.amounts.map(x => convertBalance(x, BigIntify)));
    }
  });
});