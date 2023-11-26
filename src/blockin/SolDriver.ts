import { IChainDriver } from "blockin"
import { Asset } from "blockin/dist/types/verify.types"
import bs58 from "bs58"
import nacl from "tweetnacl"
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
export default class SolDriver implements IChainDriver<bigint> {
  chain
  constructor(chain: string) {
    this.chain = chain
  }

  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array) {
    const txnString = new TextDecoder().decode(txnBytes)
    return txnString
  }


  isValidAddress(address: string) {
    return address.length === 44
  }


  async verifySignature(originalChallengeToUint8Array: Uint8Array, signedChallenge: Uint8Array, originalAddress: string) {
    const solanaPublicKeyBase58 = originalAddress;

    // Decode the base58 Solana public key
    const solanaPublicKeyBuffer = bs58.decode(solanaPublicKeyBase58);
    const verified = nacl.sign.detached.verify(
      originalChallengeToUint8Array,
      signedChallenge,
      solanaPublicKeyBuffer
    )

    if (!verified) {
      throw `Signature Invalid`
    }
  }


  async verifyAssets(address: string, resources: string[], _assets: Asset<bigint>[], balancesSnapshot?: object): Promise<any> {

    let solAssets: Asset<bigint>[] = []
    let bitbadgesAssets: Asset<bigint>[] = []
    if (resources) {

    }

    if (_assets) {
      solAssets = _assets.filter((elem) => elem.chain === "Solana")
      bitbadgesAssets = _assets.filter((elem) => elem.chain === "BitBadges")
    }

    if (solAssets.length === 0 && bitbadgesAssets.length === 0) return //No assets to verify

    if (bitbadgesAssets.length > 0) {
      await verifyBitBadgesAssets(bitbadgesAssets, address, balancesSnapshot)
    }

    if (solAssets.length > 0) {
      throw new Error(`Solana assets are not yet supported`)
    }
  }
}