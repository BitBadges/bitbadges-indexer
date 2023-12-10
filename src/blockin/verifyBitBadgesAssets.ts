import { Balance, BigIntify, UintRange, convertBalance, convertUintRange } from "bitbadgesjs-proto"
import { OffChainBalancesMap, convertToCosmosAddress, getBalancesForIds } from "bitbadgesjs-utils"
import { Asset } from "blockin"
import { BalanceModel, getFromDB } from "../db/db"

export async function verifyBitBadgesAssets(bitbadgesAssets: Asset<bigint>[], address: string, balancesSnapshot?: object): Promise<any> {
  for (const asset of bitbadgesAssets) {
    let docBalances: Balance<bigint>[] = []
    if (!balancesSnapshot) {
      const balanceDoc = await getFromDB(BalanceModel, `${asset.collectionId}:${convertToCosmosAddress(address)}`)

      if (!balanceDoc) {
        docBalances = []
      } else {
        docBalances = balanceDoc.balances.map((x) => convertBalance(x, BigIntify))
      }
    } else {
      const cosmosAddress = convertToCosmosAddress(address)
      const balancesSnapshotObj = balancesSnapshot as OffChainBalancesMap<bigint>
      docBalances = balancesSnapshotObj[cosmosAddress] ? balancesSnapshotObj[cosmosAddress].map(x => convertBalance(x, BigIntify)) : []
    }

    if (
      !asset.assetIds.every(
        (x) => typeof x === "object" && BigInt(x.start) >= 0 && BigInt(x.end) >= 0,
      )
    ) {
      throw new Error(`All assetIds must be UintRanges for BitBadges compatibility`)
    }

    if (
      asset.ownershipTimes &&
      !asset.ownershipTimes.every(
        (x) => typeof x === "object" && BigInt(x.start) >= 0 && BigInt(x.end) >= 0,
      )
    ) {
      throw new Error(`All ownershipTimes must be UintRanges for BitBadges compatibility`)
    }

    if (
      asset.mustOwnAmounts && !(typeof asset.mustOwnAmounts === "object" && BigInt(asset.mustOwnAmounts.start) >= 0 && BigInt(asset.mustOwnAmounts.end) >= 0)
    ) {
      throw new Error(`mustOwnAmount must be UintRange for BitBadges compatibility`)
    }

    if (!asset.ownershipTimes) {
      asset.ownershipTimes = [{ start: BigInt(Date.now()), end: BigInt(Date.now()) }]
    }

    const balances = getBalancesForIds(
      asset.assetIds.map((x) => convertUintRange(x as UintRange<bigint>, BigIntify)),
      asset.ownershipTimes.map((x) => convertUintRange(x, BigIntify)),
      docBalances,
    )

    const mustOwnAmount = asset.mustOwnAmounts
    for (const balance of balances) {
      if (balance.amount < mustOwnAmount.start) {
        throw new Error(
          `Address ${address} does not own enough of IDs ${balance.badgeIds
            .map((x) => `${x.start}-${x.end}`)
            .join(",")} from collection ${asset.collectionId
          } to meet minimum balance requirement of ${mustOwnAmount.start}`,
        )
      }

      if (balance.amount > mustOwnAmount.end) {
        throw new Error(
          `Address ${address} owns too much of IDs ${balance.badgeIds
            .map((x) => `${x.start}-${x.end}`)
            .join(",")} from collection ${asset.collectionId
          } to meet maximum balance requirement of ${mustOwnAmount.end}`,
        )
      }
    }
  }

}