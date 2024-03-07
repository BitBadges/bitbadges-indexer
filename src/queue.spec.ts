import { BigIntify, QueueDoc, convertOffChainBalancesMap, convertToCosmosAddress } from 'bitbadgesjs-sdk';
import mongoose from 'mongoose';
import { MongoDB, deleteMany, getFromDB, insertToDB } from './db/db';
import { AddressListModel, BalanceModel, QueueModel } from './db/schemas';
import { gracefullyShutdown } from './indexer';
import { connectToRpc } from './poll';
import { handleBalances } from './queue';

const helperAddressesArr = [
  'cosmos1kg4p6r0e5w309qqsg4zgzv058t2pp8hlxmztdr',
  'cosmos1kgg7fnyy3f7r8lh9c6dj383v3spagkfvn80p6h',
  'cosmos1vvdld2ku04t2qu3swh2qrmfp60up63zkaqmz3n',
  'cosmos16zhn3jw04z6d8t824mczt4dn0gpz7pgakkrwl0',
  'cosmos1e3w06yty28d8xezlmdqyyt20z5hjqz4zy4apj2'
];

// set env variables

describe('queue works', () => {
  beforeAll(async () => {
    process.env.DISABLE_API = 'false';
    process.env.DISABLE_URI_POLLER = 'false';
    process.env.DISABLE_BLOCKCHAIN_POLLER = 'true';
    process.env.DISABLE_NOTIFICATION_POLLER = 'true';
    process.env.TEST_MODE = 'true';

    while (!MongoDB.readyState) {}

    await connectToRpc();
  });

  afterAll(async () => {
    await gracefullyShutdown();
  });

  it('adds to queue', async () => {
    const docId = Date.now().toString();

    await insertToDB(
      QueueModel,
      new QueueDoc<bigint>({
        _docId: docId,
        uri: 'ipfs://QmWqkWs28YLDcc1FJuYeQitw7opUNRWXeNjJ6oJigZVM9R',
        collectionId: 5n,
        loadBalanceId: 0n,
        refreshRequestTime: BigInt(Date.now()),
        numRetries: 0n,
        nextFetchTime: BigInt(Date.now())
      })
    );
    const doc = await getFromDB(QueueModel, docId);
    expect(doc).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 15000));

    const doc2 = await getFromDB(QueueModel, docId);
    expect(doc2).toBeUndefined();
  }, 30000);

  beforeEach(async () => {
    const allDocsForCollectionFive = await BalanceModel.find({
      collectionId: 5
    });
    await deleteMany(
      BalanceModel,
      allDocsForCollectionFive.map((x) => x._docId)
    );

    await insertToDB(BalanceModel, {
      _docId: '5:Total',
      balances: [
        {
          amount: 1,
          badgeIds: [
            {
              start: 1,
              end: 100
            }
          ],
          ownershipTimes: [
            {
              start: 1,
              end: '18446744073709551615'
            }
          ]
        }
      ],
      collectionId: 5,
      cosmosAddress: 'Total',
      incomingApprovals: [],
      onChain: true,
      outgoingApprovals: [],
      updateHistory: [],
      userPermissions: {
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: [],
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: []
      },
      contentHash: '',
      fetchedAt: 1702646091425,
      fetchedAtBlock: 5,
      isPermanent: false,
      uri: 'https://api.bitbadges.io/somethingdifferent',
      autoApproveSelfInitiatedIncomingTransfers: false,
      autoApproveSelfInitiatedOutgoingTransfers: false
    });

    await insertToDB(BalanceModel, {
      _docId: '5:Mint',
      balances: [
        {
          amount: 1,
          badgeIds: [
            {
              start: 1,
              end: 100
            }
          ],
          ownershipTimes: [
            {
              start: 1,
              end: '18446744073709551615'
            }
          ]
        }
      ],
      collectionId: 5,
      cosmosAddress: 'Mint',
      incomingApprovals: [],
      onChain: true,
      outgoingApprovals: [],
      updateHistory: [],
      userPermissions: {
        canUpdateIncomingApprovals: [],
        canUpdateOutgoingApprovals: [],
        canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
        canUpdateAutoApproveSelfInitiatedOutgoingTransfers: []
      },
      contentHash: '',
      fetchedAt: 1702646091425,
      fetchedAtBlock: 5,
      isPermanent: false,
      uri: 'https://api.bitbadges.io/somethingdifferent',
      autoApproveSelfInitiatedIncomingTransfers: false,
      autoApproveSelfInitiatedOutgoingTransfers: false
    });
  });

  afterEach(() => {
    // Reset the mock state between tests
    jest.clearAllMocks();
  });

  afterAll(() => {
    mongoose.disconnect().catch(console.error);
  });

  it('should add balance and activity docs', async () => {
    const balanceMap = convertOffChainBalancesMap(
      {
        [helperAddressesArr[0]]: [
          {
            amount: 1n,
            badgeIds: [{ start: 1n, end: 1n }],
            ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }]
          }
        ]
      },
      BigIntify
    );

    const queueObj = new QueueDoc<bigint>({
      _docId: 'test',
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
      loadBalanceId: 0n,
      refreshRequestTime: 0n,
      numRetries: 0n
    });
    const blockNumber = 5n;

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    const doc = await getFromDB(BalanceModel, `${queueObj.collectionId}:${convertToCosmosAddress(helperAddressesArr[0])}`);

    expect(doc).toBeDefined();
    if (!doc) throw new Error('doc is undefined'); // to satisfy TS
    expect(doc.cosmosAddress).toEqual(convertToCosmosAddress(helperAddressesArr[0]));
    expect(doc.balances).toBeDefined();
    expect(doc.balances.length).toEqual(1);

    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded.activityToAdd).toBeDefined();
    expect(docsCacheAdded.activityToAdd.length).toEqual(1);
  });

  it('should support address lists', async () => {
    const docs = await AddressListModel.find({
      _docId: {
        $regex: 'sample-' + '*'
      },
      whitelist: true
    })
      .lean()
      .exec();
    const listDoc = docs[0];
    const addressInList = listDoc.addresses[0];

    const balanceMap = convertOffChainBalancesMap(
      {
        [`${listDoc.listId}`]: [
          {
            amount: 1n,
            badgeIds: [{ start: 1n, end: 1n }],
            ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }]
          }
        ]
      },
      BigIntify
    );

    const queueObj = new QueueDoc<bigint>({
      _docId: 'test',
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
      loadBalanceId: 0n,
      refreshRequestTime: 0n,
      numRetries: 0n
    });
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const doc = await getFromDB(BalanceModel, `${queueObj.collectionId}:${convertToCosmosAddress(addressInList)}`);

    expect(doc).toBeDefined();
    if (!doc) throw new Error('doc is undefined'); // to satisfy TS
    expect(doc.cosmosAddress).toEqual(convertToCosmosAddress(addressInList));
    expect(doc.balances).toBeDefined();
    expect(doc.balances.length).toEqual(1);
  });

  it('should underflow balances', async () => {
    const balanceMap = convertOffChainBalancesMap(
      {
        [helperAddressesArr[0]]: [
          {
            amount: 10000n,
            badgeIds: [{ start: 1n, end: 1n }],
            ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }]
          }
        ]
      },
      BigIntify
    );

    const queueObj = new QueueDoc<bigint>({
      _docId: 'test',
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
      loadBalanceId: 0n,
      refreshRequestTime: 0n,
      numRetries: 0n
    });
    const blockNumber = 5n;

    // should catch an underflow error
    await expect(handleBalances(balanceMap, queueObj, blockNumber)).rejects.toThrow();
  });

  it('should not add activity if no change', async () => {
    const balanceMap = convertOffChainBalancesMap(
      {
        [helperAddressesArr[0]]: [
          {
            amount: 1n,
            badgeIds: [{ start: 1n, end: 1n }],
            ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }]
          }
        ]
      },
      BigIntify
    );

    const queueObj = new QueueDoc<bigint>({
      _docId: 'test',
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
      loadBalanceId: 0n,
      refreshRequestTime: 0n,
      numRetries: 0n
    });
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded.activityToAdd.length).toEqual(0);
  });

  it('should update mint / total timestamps even if no change', async () => {
    const balanceMap = convertOffChainBalancesMap(
      {
        [helperAddressesArr[0]]: [
          {
            amount: 1n,
            badgeIds: [{ start: 1n, end: 1n }],
            ownershipTimes: [{ start: 1692021600000n, end: 1723557600000n }]
          }
        ]
      },
      BigIntify
    );

    const queueObj = new QueueDoc<bigint>({
      _docId: 'test',
      uri: 'https://api.bitbadges.io',
      collectionId: 5n,
      loadBalanceId: 0n,
      refreshRequestTime: 0n,
      numRetries: 0n
    });
    const blockNumber = 5n;

    await handleBalances(balanceMap, queueObj, blockNumber);

    const mintDoc = await getFromDB(BalanceModel, `${queueObj.collectionId}:Mint`);
    expect(mintDoc).toBeDefined();
    if (!mintDoc) throw new Error('mintDoc is undefined'); // to satisfy TS
    const beforeTimestamp = mintDoc.fetchedAt;

    const docsCacheAdded = await handleBalances(balanceMap, queueObj, blockNumber);

    const mintDocAfter = await getFromDB(BalanceModel, `${queueObj.collectionId}:Mint`);
    expect(mintDocAfter).toBeDefined();
    if (!mintDocAfter) throw new Error('mintDocAfter is undefined'); // to satisfy TS
    const afterTimestamp = mintDocAfter.fetchedAt;

    expect(beforeTimestamp).not.toEqual(afterTimestamp);
    expect(docsCacheAdded).toBeDefined();
    expect(docsCacheAdded.activityToAdd.length).toEqual(0);
  });
});
