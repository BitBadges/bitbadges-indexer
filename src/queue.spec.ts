
const express = require('express');
// const https = require('https');

// Mock Express app and middleware functions
const app = express();
app.use = jest.fn(() => app);
app.get = jest.fn();
app.post = jest.fn();
app.listen = jest.fn(() => app);

import { OffChainBalancesMap, QueueDoc, convertToCosmosAddress } from 'bitbadgesjs-utils';
import { AddressMappingModel, BalanceModel, deleteMany, getFromDB, insertToDB } from './db/db';
import { handleBalances } from './queue';
import mongoose from 'mongoose';

const helperAddressesArr = [
  "cosmos1kg4p6r0e5w309qqsg4zgzv058t2pp8hlxmztdr",
  "cosmos1kgg7fnyy3f7r8lh9c6dj383v3spagkfvn80p6h",
  "cosmos1vvdld2ku04t2qu3swh2qrmfp60up63zkaqmz3n",
  "cosmos16zhn3jw04z6d8t824mczt4dn0gpz7pgakkrwl0",
  "cosmos1e3w06yty28d8xezlmdqyyt20z5hjqz4zy4apj2",
]

//set env variables

describe('handleBalances', () => {

  beforeEach(async () => {
    const allDocsForCollectionFive = await BalanceModel.find({ collectionId: 5n });
    await deleteMany(BalanceModel, allDocsForCollectionFive.map(x => x._legacyId));

    await insertToDB(BalanceModel, {
      "_legacyId": "5:Total",
      "balances": [
        {
          "amount": 1,
          "badgeIds": [
            {
              "start": 1,
              "end": 100
            }
          ],
          "ownershipTimes": [
            {
              "start": 1,
              "end": "18446744073709551615"
            }
          ]
        }
      ],
      "collectionId": 5,
      "cosmosAddress": "Total",
      "incomingApprovals": [],
      "onChain": true,
      "outgoingApprovals": [],
      "updateHistory": [],
      "userPermissions": {
        "canUpdateIncomingApprovals": [],
        "canUpdateOutgoingApprovals": [],
        "canUpdateAutoApproveSelfInitiatedIncomingTransfers": [],
        "canUpdateAutoApproveSelfInitiatedOutgoingTransfers": []
      },
      "contentHash": "",
      "fetchedAt": 1702646091425,
      "fetchedAtBlock": 5,
      "isPermanent": false,
      "uri": "https://api.bitbadges.io/somethingdifferent",
    });

    await insertToDB(BalanceModel, {
      "_legacyId": "5:Mint",
      "balances": [
        {
          "amount": 1,
          "badgeIds": [
            {
              "start": 1,
              "end": 100
            }
          ],
          "ownershipTimes": [
            {
              "start": 1,
              "end": "18446744073709551615"
            }
          ]
        }
      ],
      "collectionId": 5,
      "cosmosAddress": "Mint",
      "incomingApprovals": [],
      "onChain": true,
      "outgoingApprovals": [],
      "updateHistory": [],
      "userPermissions": {
        "canUpdateIncomingApprovals": [],
        "canUpdateOutgoingApprovals": [],
        "canUpdateAutoApproveSelfInitiatedIncomingTransfers": [],
        "canUpdateAutoApproveSelfInitiatedOutgoingTransfers": []
      },
      "contentHash": "",
      "fetchedAt": 1702646091425,
      "fetchedAtBlock": 5,
      "isPermanent": false,
      "uri": "https://api.bitbadges.io/somethingdifferent",
    });
  });

  afterEach(() => {
    // Reset the mock state between tests
    jest.clearAllMocks();

  });

  afterAll(() => {
    mongoose.disconnect();
  });

  it('should add balance and activity docs', async () => {
    const balanceMap: OffChainBalancesMap<bigint> = {
      [helperAddressesArr[0]]: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }], }],
    }

    const queueObj: QueueDoc<bigint> = {
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
    } as QueueDoc<bigint>;
    const blockNumber = 5n;

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    const doc = await getFromDB(BalanceModel, `${queueObj.collectionId}:${convertToCosmosAddress(helperAddressesArr[0])}`);

    expect(doc).toBeDefined();
    expect(doc!.cosmosAddress).toEqual(convertToCosmosAddress(helperAddressesArr[0]));
    expect(doc!.balances).toBeDefined();
    expect(doc!.balances!.length).toEqual(1);

    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded!.activityToAdd).toBeDefined();
    expect(docsCacheAdded!.activityToAdd!.length).toEqual(1);
  });

  it('should support address mappings', async () => {
    await insertToDB(AddressMappingModel, {
      _legacyId: 'test',
      mappingId: 'test',
      addresses: [helperAddressesArr[0]],
      includeAddresses: true,
      uri: 'https://api.bitbadges.io',
      customData: '',
      createdBy: '',
      updateHistory: [],
      createdBlock: 0n,
      lastUpdated: 0n,
    });

    const balanceMap: OffChainBalancesMap<bigint> = {
      'test': [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }], }],
    }

    const queueObj: QueueDoc<bigint> = {
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
    } as QueueDoc<bigint>;
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const doc = await getFromDB(BalanceModel, `${queueObj.collectionId}:${convertToCosmosAddress(helperAddressesArr[0])}`);

    expect(doc).toBeDefined();
    expect(doc!.cosmosAddress).toEqual(convertToCosmosAddress(helperAddressesArr[0]));
    expect(doc!.balances).toBeDefined();
    expect(doc!.balances!.length).toEqual(1);
  });

  it('should underflow balances', async () => {
    const balanceMap: OffChainBalancesMap<bigint> = {
      [helperAddressesArr[0]]: [{ amount: 10000n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }], }],
    }

    const queueObj: QueueDoc<bigint> = {
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
    } as QueueDoc<bigint>;
    const blockNumber = 5n;

    //should catch an underflow error
    await expect(handleBalances(balanceMap, queueObj, blockNumber)).rejects.toThrow();
  });

  it('should not add activity if no change', async () => {
    const balanceMap: OffChainBalancesMap<bigint> = {
      [helperAddressesArr[0]]: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }], }],
    }

    const queueObj: QueueDoc<bigint> = {
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
    } as QueueDoc<bigint>;
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded!.activityToAdd.length).toEqual(0);
  });

  it('should update mint / total timestamps even if no change', async () => {
    const balanceMap: OffChainBalancesMap<bigint> = {
      [helperAddressesArr[0]]: [{ amount: 1n, badgeIds: [{ start: 1n, end: 1n }], ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }], }],
    }

    const queueObj: QueueDoc<bigint> = {
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
    } as QueueDoc<bigint>;
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const mintDoc = await getFromDB(BalanceModel, `${queueObj.collectionId}:Mint`);
    expect(mintDoc).toBeDefined();
    const beforeTimestamp = mintDoc!.fetchedAt;

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    const mintDocAfter = await getFromDB(BalanceModel, `${queueObj.collectionId}:Mint`);
    expect(mintDocAfter).toBeDefined();
    const afterTimestamp = mintDocAfter!.fetchedAt;

    expect(beforeTimestamp).not.toEqual(afterTimestamp);
    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded!.activityToAdd.length).toEqual(0);
  });
});
