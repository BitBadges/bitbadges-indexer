import { verifyADR36Amino } from '@keplr-wallet/cosmos';
import axiosApi from 'axios';
import { Stringify, SupportedChain, getChainForAddress, type BalanceArray, type NumberType } from 'bitbadgesjs-sdk';
import { constructChallengeObjectFromString, type AssetConditionGroup, type IChainDriver } from 'blockin';
import { Buffer } from 'buffer';
import { verifyBitBadgesAssets } from './verifyBitBadgesAssets';

export const axios = axiosApi.create({
  withCredentials: true,
  headers: {
    'Content-type': 'application/json'
  }
});

/**
 * Cosmos implementation of the IChainDriver interface.
 *
 * For documentation regarding what each function does, see the IChainDriver interface.
 *
 * Note that the Blockin library also has many convenient, chain-generic functions that implement
 * this logic for creating / verifying challenges. Before using, you will have to setChainDriver(new CosmosDriver(.....)) first.
 */
export default class CosmosDriver implements IChainDriver<NumberType> {
  chain;
  constructor(chain: string) {
    this.chain = chain;
  }

  isValidAddress(address: string) {
    return getChainForAddress(address) === SupportedChain.COSMOS;
  }

  async verifySignature(message: string, signature: string, publicKey?: string) {
    if (!publicKey) {
      throw new Error('Public key is required for Cosmos. This may not be required for other chains.');
    }

    const originalString = message;
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address;

    const signatureBuffer = Buffer.from(signature, 'base64');
    const uint8Signature = new Uint8Array(signatureBuffer); // Convert the buffer to an Uint8Array

    const pubKeyValueBuffer = Buffer.from(publicKey, 'base64'); // Decode the base64 encoded value
    const pubKeyUint8Array = new Uint8Array(pubKeyValueBuffer); // Convert the buffer to an Uint8Array

    // concat the two Uint8Arrays //This is probably legacy code and can be removed
    const signedChallenge = new Uint8Array(pubKeyUint8Array.length + uint8Signature.length);
    signedChallenge.set(pubKeyUint8Array);
    signedChallenge.set(uint8Signature, pubKeyUint8Array.length);

    const pubKeyBytes = signedChallenge.slice(0, 33);
    const signatureBytes = signedChallenge.slice(33);

    const prefix = 'cosmos'; // change prefix for other chains...

    const isRecovered = verifyADR36Amino(prefix, originalAddress, originalString, pubKeyBytes, signatureBytes, 'secp256k1');

    if (!isRecovered) {
      throw new Error(`Signature invalid for address ${originalAddress}`);
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
