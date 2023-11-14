import { Balance, BigIntify, UintRange, convertBalance, convertUintRange } from "bitbadgesjs-proto"
import { OffChainBalancesMap, convertToCosmosAddress, getBalancesForIds } from "bitbadgesjs-utils"
import { IChainDriver } from "blockin"
import { Asset } from "blockin/dist/types/verify.types"
import { Buffer } from "buffer"
import { recoverPersonalSignature } from "eth-sig-util"
import { ethers } from "ethers"
import { BALANCES_DB } from "../db/db"
import { catch404 } from "../utils/couchdb-utils"

/**
 * Ethereum implementation of the IChainDriver interface. This implementation is based off the Moralis API
 * and ethers.js library.
 *
 * For documentation regarding what each function does, see the IChainDriver interface.
 *
 * Note that the Blockin library also has many convenient, chain-generic functions that implement
 * this logic for creating / verifying challenges. Before using, you will have to setChainDriver(new EthDriver(.....)) first.
 */
export default class EthDriver implements IChainDriver<bigint> {
  moralisDetails
  chain
  constructor(chain: string, MORALIS_DETAILS: any) {
    this.moralisDetails = MORALIS_DETAILS
      ? MORALIS_DETAILS
      : {
        apiKey: '',
      }
    // if (MORALIS_DETAILS) Moralis.start(this.moralisDetails)
    this.chain = chain
  }

  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array) {
    const txnString = new TextDecoder().decode(txnBytes)
    const txnString2 = Buffer.from(txnString.substring(2), "hex").toString()
    return txnString2
  }
  isValidAddress(address: string) {
    return ethers.utils.isAddress(address)
  }
  async verifySignature(originalChallengeToUint8Array: Uint8Array, signedChallenge: Uint8Array, originalAddress: string) {
    const original = new TextDecoder().decode(originalChallengeToUint8Array)
    const signed = new TextDecoder().decode(signedChallenge)
    const recoveredAddr = recoverPersonalSignature({
      data: original,
      sig: signed,
    })
    if (recoveredAddr.toLowerCase() !== originalAddress.toLowerCase()) {
      throw `Signature Invalid: Expected ${originalAddress} but got ${recoveredAddr}`
    }
  }


  async verifyAssets(address: string, resources: string[], _assets: Asset<bigint>[], balancesSnapshot?: object): Promise<any> {

    let ethAssets: Asset<bigint>[] = []
    let bitbadgesAssets: Asset<bigint>[] = []
    if (resources) {

    }

    if (_assets) {
      ethAssets = _assets.filter((elem) => elem.chain === "Ethereum")
      bitbadgesAssets = _assets.filter((elem) => elem.chain === "BitBadges")
    }

    if (ethAssets.length === 0 && bitbadgesAssets.length === 0) return //No assets to verify

    if (bitbadgesAssets.length > 0) {
      for (const asset of bitbadgesAssets) {
        let docBalances: Balance<bigint>[] = []
        if (!balancesSnapshot) {
          const balanceDoc = await BALANCES_DB.get(
            `${asset.collectionId}:${convertToCosmosAddress(address)}`,
          ).catch(catch404)

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

    if (ethAssets.length > 0) {
      throw new Error(`Ethereum assets are not yet supported`)
    }
  }
}