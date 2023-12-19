import { IChainDriver, constructChallengeObjectFromString } from "blockin"
import { Asset } from "blockin"
import { Buffer } from "buffer"
import { recoverPersonalSignature } from "eth-sig-util"
import { ethers } from "ethers"
import { verifyBitBadgesAssets } from "./verifyBitBadgesAssets"
import { Stringify } from "bitbadgesjs-proto"
import { OffChainBalancesMap } from "bitbadgesjs-utils"

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
    return new TextDecoder().decode(txnBytes)
  }
  isValidAddress(address: string) {
    return ethers.utils.isAddress(address)
  }

  async verifySignature(message: string, signature: string) {
    const originalChallengeToUint8Array = new TextEncoder().encode(message)
    const signedChallenge = new Uint8Array(Buffer.from(signature, 'utf8'))
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address

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


  async verifyAssets(address: string, resources: string[], _assets: Asset<bigint>[], balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {

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
      await verifyBitBadgesAssets(bitbadgesAssets, address, balancesSnapshot)
    }

    if (ethAssets.length > 0) {
      throw new Error(`Ethereum assets are not yet supported`)
    }
  }
}