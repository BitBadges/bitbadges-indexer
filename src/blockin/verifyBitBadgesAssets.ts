import { Balance, BigIntify, UintRange, convertBalance, convertUintRange } from "bitbadgesjs-sdk"
import { OffChainBalancesMap, addBalances, convertToCosmosAddress, getBalancesForIds, isInAddressList } from "bitbadgesjs-sdk"
import { AssetConditionGroup } from "blockin"
import { BalanceModel, getFromDB } from "../db/db"
import { getAddressListsFromDB } from "../routes/utils"
import { AndGroup, OrGroup, OwnershipRequirements } from "blockin"

export async function verifyBitBadgesAssets(bitbadgesAssets: AssetConditionGroup<bigint> | undefined, address: string, balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {
  if (!bitbadgesAssets) return;

  const andItem: AndGroup<bigint> = bitbadgesAssets as AndGroup<bigint>
  const orItem: OrGroup<bigint> = bitbadgesAssets as OrGroup<bigint>
  const normalItem: OwnershipRequirements<bigint> = bitbadgesAssets as OwnershipRequirements<bigint>

  if (andItem.$and) {
    for (const item of andItem.$and) {
      await verifyBitBadgesAssets(item, address, balancesSnapshot)
    }
  } else if (orItem.$or) {
    for (const item of orItem.$or) {
      try {
        await verifyBitBadgesAssets(item, address, balancesSnapshot)
        return  //if we get here, we are good (short circuit)
      } catch (e) {
        continue
      }
    }

    throw new Error(`Address did not meet the asset ownership requirements.`)
  } else {
    const numToSatisfy = normalItem.options?.numMatchesForVerification ?? 0;
    const mustSatisfyAll = !numToSatisfy;

    let numSatisfied = 0;

    for (const asset of normalItem.assets) {
      if (asset.chain !== 'BitBadges') {
        throw new Error(`Only BitBadges assets are supported for now`)
      }

      let docBalances: Balance<bigint>[] = []
      if (!balancesSnapshot) {
        if (asset.collectionId !== 'BitBadges Lists') {
          const balanceDoc = await getFromDB(BalanceModel, `${asset.collectionId}:${convertToCosmosAddress(address)}`)

          if (!balanceDoc) {
            docBalances = []
          } else {
            docBalances = balanceDoc.balances.map((x) => convertBalance(x, BigIntify))
          }
        }
      } else {
        const cosmosAddress = convertToCosmosAddress(address)
        const balancesSnapshotObj = balancesSnapshot
        docBalances = balancesSnapshotObj[cosmosAddress] ? balancesSnapshotObj[cosmosAddress].map(x => convertBalance(x, BigIntify)) : []
      }

      if (asset.collectionId === 'BitBadges Lists') {
        if (!asset.assetIds.every((x) => typeof x === "string")) {
          throw new Error(`For "BitBadges Lists" collection, all assetIds must be the list IDs as strings`)
        }


      } else {
        if (
          !asset.assetIds.every(
            (x) => typeof x === "object" && BigInt(x.start) >= 0 && BigInt(x.end) >= 0,
          )
        ) {
          throw new Error(`All assetIds must be UintRanges for BitBadges compatibility`)
        }
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

      if (asset.collectionId === 'BitBadges Lists') {
        if (asset.mustOwnAmounts && !(asset.mustOwnAmounts.start === 1n || asset.mustOwnAmounts.start === 0n)) {
          throw new Error(`mustOwnAmount must be 0 or 1 for BitBadges Lists`)
        }

        if (asset.mustOwnAmounts && (asset.mustOwnAmounts.start !== asset.mustOwnAmounts.end)) {
          throw new Error(`mustOwnAmount must be the same start and end for BitBadges Lists (x0-0 or x1-1)`)
        }
      }

      if (!asset.ownershipTimes || asset.ownershipTimes.length === 0) {
        asset.ownershipTimes = [{ start: BigInt(Date.now()), end: BigInt(Date.now()) }]
      }


      let balances: Balance<bigint>[] = [];

      if (asset.collectionId === 'BitBadges Lists') {
        //Little hacky but it works
        const res = await getAddressListsFromDB((asset.assetIds as string[]).map(x => ({ listId: x })), false)

        for (let i = 0; i < res.length; i++) {
          const list = res[i];
          const badgeId = BigInt(i + 1)

          if (!list) {
            throw new Error(`Could not find list with ID ${asset.assetIds[0]}`)
          }

          list.addresses = list.addresses.map(x => convertToCosmosAddress(x))

          if (isInAddressList(list, convertToCosmosAddress(address))) {
            balances = addBalances([{
              badgeIds: [{ start: badgeId, end: badgeId }], amount: 1n, ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }]
            }], balances)
          } else {
            balances = addBalances([{
              badgeIds: [{ start: badgeId, end: badgeId }], amount: 0n, ownershipTimes: [{ start: 1n, end: BigInt("18446744073709551615") }]
            }], balances)
          }
        }
      } else {
        balances = getBalancesForIds(
          asset.assetIds.map((x) => convertUintRange(x as UintRange<bigint>, BigIntify)),
          asset.ownershipTimes.map((x) => convertUintRange(x, BigIntify)),
          docBalances,
        )
      }

      const mustOwnAmount = asset.mustOwnAmounts

      for (const balance of balances) {
        if (balance.amount < mustOwnAmount.start) {
          if (mustSatisfyAll) {
            if (asset.collectionId === 'BitBadges Lists') {
              const listIdIdx = balance.badgeIds[0].start - 1n;
              const correspondingListId = asset.assetIds[Number(listIdIdx)]
              throw new Error(
                `Address ${address} does not meet the requirements for list ${correspondingListId}`,
              )
            } else {
              throw new Error(
                `Address ${address} does not own enough of IDs ${balance.badgeIds
                  .map((x) => `${x.start}-${x.end}`)
                  .join(",")} from collection ${asset.collectionId
                } to meet minimum balance requirement of ${mustOwnAmount.start}`,
              )
            }
          } else {
            continue
          }
        }

        if (balance.amount > mustOwnAmount.end) {
          if (mustSatisfyAll) {
            if (asset.collectionId === 'BitBadges Lists') {
              const listIdIdx = balance.badgeIds[0].start - 1n;
              const correspondingListId = asset.assetIds[Number(listIdIdx)]
              throw new Error(
                `Address ${address} does not meet requirements for list ${correspondingListId}`,
              )
            }
            else {
              throw new Error(
                `Address ${address} owns too much of IDs ${balance.badgeIds
                  .map((x) => `${x.start}-${x.end}`)
                  .join(",")} from collection ${asset.collectionId
                } to meet maximum balance requirement of ${mustOwnAmount.end}`,
              )
            }
          } else {
            continue
          }
        }

        numSatisfied++;
      }


    }


    if (mustSatisfyAll) {
      //we made it through all balances and didn't throw an error so we are good
    } else if (numSatisfied < numToSatisfy) {
      throw new Error(
        `Address ${address} did not meet the ownership requirements.`,
      )
    }
  }

}