import { Verifier } from "bip322-js"
import { Stringify } from "bitbadgesjs-proto"
import { OffChainBalancesMap, convertToCosmosAddress, } from "bitbadgesjs-utils"
import { Asset, IChainDriver, constructChallengeObjectFromString } from "blockin"
import { verifyBitBadgesAssets } from "./verifyBitBadgesAssets"

/**
 * Ethereum implementation of the IChainDriver interface. This implementation is based off the Moralis API
 * and ethers.js library.
 *
 * For documentation regarding what each function does, see the IChainDriver interface.
 *
 * Note that the Blockin library also has many convenient, chain-generic functions that implement
 * this logic for creating / verifying challenges. Before using, you will have to setChainDriver(new EthDriver(.....)) first.
 */
export default class BtcDriver implements IChainDriver<bigint> {
  chain
  constructor(chain: string) {
    this.chain = chain
  }

  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array) {
    return new TextDecoder().decode(txnBytes)
  }


  isValidAddress(address: string) {
    return !!convertToCosmosAddress(address)
  }


  async verifySignature(message: string, signature: string) {
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address

    const isValidSignature = Verifier.verifySignature(
      originalAddress,
      message,
      signature
    );

    if (!isValidSignature) {
      throw `Signature Invalid`
    }
  }


  async verifyAssets(address: string, resources: string[], _assets: Asset<bigint>[], balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {

    let btcAssets: Asset<bigint>[] = []
    let bitbadgesAssets: Asset<bigint>[] = []
    if (resources) {

    }

    if (_assets) {
      btcAssets = _assets.filter((elem) => elem.chain === "Bitcoin")
      bitbadgesAssets = _assets.filter((elem) => elem.chain === "BitBadges")
    }

    if (btcAssets.length === 0 && bitbadgesAssets.length === 0) return //No assets to verify

    if (bitbadgesAssets.length > 0) {
      await verifyBitBadgesAssets(bitbadgesAssets, address, balancesSnapshot)
    }

    if (btcAssets.length > 0) {
      throw new Error(`Bitcoin assets are not yet supported`)
    }
  }
}