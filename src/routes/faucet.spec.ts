import { iQueueDoc, mustConvertToCosmosAddress } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { insertToDB } from '../db/db';
import { QueueModel } from '../db/schemas';
import { client } from '../indexer-vars';

dotenv.config();

describe('faucet works correctly', () => {
  it('should correctly handle many concurrent faucet txs', async () => {
    const addresses = [];
    const currTime = Date.now();
    while (Date.now() - currTime < 1000 * 10) {
      const ethAddress = ethers.Wallet.createRandom().address;
      const cosmosAddress = mustConvertToCosmosAddress(ethAddress);
      addresses.push(cosmosAddress);

      const id = crypto.randomBytes(32).toString('hex');
      const newQueueDoc: iQueueDoc<bigint> = {
        _docId: id,
        notificationType: 'faucet',
        collectionId: 0n,
        uri: '',
        loadBalanceId: 0n,
        refreshRequestTime: BigInt(Date.now()),
        numRetries: 0n,
        nextFetchTime: BigInt(Date.now()),
        faucetInfo: {
          txHash: '',
          recipient: cosmosAddress,
          amount: BigInt(1000)
        }
      };
      await insertToDB(QueueModel, newQueueDoc);
      await Promise.resolve(setTimeout(() => {}, 500));
    }

    await new Promise((resolve) => setTimeout(resolve, 10000)); //wait for the queue to be processed

    for (const address of addresses) {
      const amounts = await client?.getBalance(address, 'ubadge');
      expect(amounts).toBeDefined();
      expect(Number(amounts?.amount)).toBeGreaterThan(0);
      expect(amounts?.denom).toBe('ubadge');
      expect(Number(amounts?.amount)).toEqual(1000);
    }
  }, 1000000);
});
