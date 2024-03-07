import { type BalanceArray, Stringify } from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, type AssetConditionGroup, type IChainDriver } from 'blockin';
import { Buffer } from 'buffer';
import { recoverPersonalSignature } from 'eth-sig-util';
import { ethers } from 'ethers';
import { TextDecoder, TextEncoder } from 'node:util';
import { verifyBitBadgesAssets } from './verifyBitBadgesAssets';

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
  chain;
  constructor(chain: string) {
    this.chain = chain;
  }

  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array) {
    return new TextDecoder().decode(txnBytes);
  }

  isValidAddress(address: string) {
    return ethers.utils.isAddress(address);
  }

  async verifySignature(message: string, signature: string) {
    const originalChallengeToUint8Array = new TextEncoder().encode(message);
    const signedChallenge = new Uint8Array(Buffer.from(signature, 'utf8'));
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address;

    const original = new TextDecoder().decode(originalChallengeToUint8Array);
    const signed = new TextDecoder().decode(signedChallenge);
    const recoveredAddr = recoverPersonalSignature({
      data: original,
      sig: signed
    });
    if (recoveredAddr.toLowerCase() !== originalAddress.toLowerCase()) {
      throw new Error(`Signature Invalid: Expected ${originalAddress} but got ${recoveredAddr}`);
    }
  }

  async verifyAssets(
    address: string,
    _resources: string[],
    assets: AssetConditionGroup<bigint> | undefined,
    balancesSnapshot?: Record<string, Record<string, BalanceArray<bigint>>>
  ) {
    await verifyBitBadgesAssets(assets, address, balancesSnapshot);
  }
}
