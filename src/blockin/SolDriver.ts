import { Stringify } from "bitbadgesjs-sdk"
import { OffChainBalancesMap } from "bitbadgesjs-sdk"
import { AssetConditionGroup, IChainDriver, constructChallengeObjectFromString } from "blockin"
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
    return new TextDecoder().decode(txnBytes)
  }


  isValidAddress(address: string) {
    return address.length === 44
  }


  async verifySignature(message: string, signature: string) {
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address
    const solanaPublicKeyBase58 = originalAddress;

    const originalBytes = new Uint8Array(Buffer.from(message, 'utf8'));
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'hex'));

    // Decode the base58 Solana public key
    const solanaPublicKeyBuffer = bs58.decode(solanaPublicKeyBase58);
    const verified = nacl.sign.detached.verify(
      originalBytes,
      signatureBytes,
      solanaPublicKeyBuffer
    )

    if (!verified) {
      throw `Signature Invalid`
    }
  }


  async verifyAssets(address: string, _resources: string[], assets: AssetConditionGroup<bigint> | undefined, balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {
    await verifyBitBadgesAssets(assets, address, balancesSnapshot)
  }
}