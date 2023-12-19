import { Balance } from "bitbadgesjs-proto";
import { cosmosToEth } from "bitbadgesjs-utils";
import Moralis from "moralis";
import { serializeError } from "serialize-error";
import { Request, Response } from "express";

export const getBalancesForEthFirstTx = async (cosmosAddress: string): Promise<Balance<bigint>[]> => {
  const ethAddress = cosmosToEth(cosmosAddress);
  const response = await Moralis.EvmApi.wallets.getWalletActiveChains({
    "address": ethAddress,
  });

  const firstTxTimestamp = response.raw.active_chains.find(x => x.chain === 'eth')?.first_transaction?.block_timestamp;
  const timestamp = firstTxTimestamp ? new Date(firstTxTimestamp).getFullYear() : undefined;

  //Badge ID 1 = 2015, 2 = 2016, and so on
  const badgeId = timestamp ? timestamp - 2014 : undefined;
  if (!badgeId) {
    return [];
  }

  const balances: Balance<bigint>[] = [{
    amount: 1n,
    badgeIds: [{ start: BigInt(badgeId), end: BigInt(badgeId) }],
    ownershipTimes: [{
      start: 1n, end: BigInt("18446744073709551615")
    }]
  }]

  return balances;
}

export async function getBalancesForEthFirstTxRoute(req: Request, res: Response) {

  try {
    const cosmosAddress = req.params.cosmosAddress;
    const balances = await getBalancesForEthFirstTx(cosmosAddress);
    return res.status(200).send({ balances });

  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching balances. Please try again later."
    })
  }
}