import { verifyADR36Amino } from '@keplr-wallet/cosmos';
import axiosApi from 'axios';
import { SupportedChain, convertToCosmosAddress, getChainForAddress, type BalanceArray, type NumberType } from 'bitbadgesjs-sdk';
import { type AssetConditionGroup, type IChainDriver } from 'blockin';
import { Buffer } from 'buffer';
import { getFromDB } from '../db/db';
import { AccountModel } from '../db/schemas';
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

  async verifySignature(address: string, message: string, signature: string, publicKey?: string) {
    const prefix = 'cosmos';
    if (!publicKey) {
      const fetchedPublicKey = await getFromDB(AccountModel, convertToCosmosAddress(address));
      if (!fetchedPublicKey || !fetchedPublicKey.publicKey) {
        throw new Error(
          `Public key must be provided for Cosmos signatures. We could not fetch it from the blockchain or BitBadges databases either.`
        );
      }

      publicKey = fetchedPublicKey.publicKey;
    }

    const pubKeyBytes = Buffer.from(publicKey, 'base64');
    const signatureBytes = Buffer.from(signature, 'base64');

    const isRecovered = verifyADR36Amino(prefix, address, message, pubKeyBytes, signatureBytes, 'secp256k1');
    if (!isRecovered) {
      throw new Error(`Signature invalid for address ${address}`);
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
