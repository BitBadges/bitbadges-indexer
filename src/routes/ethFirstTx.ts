import { BalanceArray, UintRangeArray, mustConvertToEthAddress, type Balance } from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import Moralis from 'moralis';
import { serializeError } from 'serialize-error';
import typia from 'typia';

export const getBalancesForEthFirstTx = async (cosmosAddress: string): Promise<Array<Balance<bigint>>> => {
  const ethAddress = mustConvertToEthAddress(cosmosAddress);
  const response = await Moralis.EvmApi.wallets.getWalletActiveChains({
    address: ethAddress
  });

  const firstTxTimestamp = response.raw.active_chains.find((x) => x.chain === 'eth')?.first_transaction?.block_timestamp;
  const timestamp = firstTxTimestamp ? new Date(firstTxTimestamp).getFullYear() : undefined;

  // Badge ID 1 = 2015, 2 = 2016, and so on
  const badgeId = timestamp ? timestamp - 2014 : undefined;
  if (!badgeId) {
    return [];
  }

  const balances = BalanceArray.From([
    {
      amount: 1n,
      badgeIds: [{ start: BigInt(badgeId), end: BigInt(badgeId) }],
      ownershipTimes: UintRangeArray.FullRanges()
    }
  ]);

  return balances;
};

export async function getBalancesForEthFirstTxRoute(req: Request, res: Response) {
  try {
    typia.assert<string>(req.params.cosmosAddress);
    const cosmosAddress = req.params.cosmosAddress;
    const balances = await getBalancesForEthFirstTx(cosmosAddress);
    return res.status(200).send({ balances });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error fetching balances.'
    });
  }
}
