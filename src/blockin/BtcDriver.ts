import { Verifier } from 'bip322-js';
import { convertToCosmosAddress, type BalanceArray } from 'bitbadgesjs-sdk';
import { type AssetConditionGroup, type IChainDriver } from 'blockin';
import { TextDecoder } from 'node:util';
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
export default class BtcDriver implements IChainDriver<bigint> {
  chain;
  constructor(chain: string) {
    this.chain = chain;
  }

  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array): Promise<string> {
    return new TextDecoder().decode(txnBytes);
  }

  isValidAddress(address: string) {
    return !!convertToCosmosAddress(address);
  }

  async verifySignature(address: string, message: string, signature: string) {
    const isValidSignature = Verifier.verifySignature(address, message, signature);
    if (!isValidSignature) {
      throw new Error('Signature Invalid');
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
