import { verifyADR36Amino } from '@keplr-wallet/cosmos';
import axiosApi from 'axios';
import { Stringify } from 'bitbadgesjs-proto';
import { NumberType, OffChainBalancesMap, SupportedChain, getChainForAddress } from 'bitbadgesjs-utils';
import { Asset, CreateAssetParams, IChainDriver, UniversalTxn, constructChallengeObjectFromString } from 'blockin';
import { Buffer } from 'buffer';
import { concat } from 'ethers/lib/utils';
import { verifyBitBadgesAssets } from './verifyBitBadgesAssets';

export const axios = axiosApi.create({
  withCredentials: true,
  headers: {
    "Content-type": "application/json",
  },
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
  /** Boilerplates - Not Implemented Yet */
  async makeAssetTxn(assetParams: CreateAssetParams) {
    throw 'Not implemented';
    return this.createUniversalTxn({}, ``);
  }
  async makeAssetTransferTxn(assetParams: any) {
    throw 'Not implemented';
    return this.createUniversalTxn({}, ``);
  }
  async sendTxn(signedTxnResult: any, txnId: string): Promise<any> {
    throw 'Not implemented';
    return;
  }
  async parseChallengeStringFromBytesToSign(txnBytes: Uint8Array) {
    return new TextDecoder().decode(txnBytes)
  }
  async lookupTransactionById(txnId: string) {
    throw 'Not implemented';
    return;
  }
  async getAssetDetails(assetId: string | Number): Promise<any> {
    throw 'Not implemented';
    return;
  }
  async getAllAssetsForAddress(address: string): Promise<any> {
    throw 'Not implemented';
    return;
  }
  async getLastBlockIndex() {
    throw 'Not implemented';
    return;
  }
  async getTimestampForBlock(blockIndexString: string) {
    throw 'Not implemented';
    return;
  }

  isValidAddress(address: string) {
    return getChainForAddress(address) === SupportedChain.COSMOS;
  }

  /**Not implemented */
  getPublicKeyFromAddress(address: string) {
    throw 'Not implemented';
    return new Uint8Array(0);
  }
  async verifySignature(message: string, signature: string): Promise<void> {

    const originalString = message;
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address;
    const originalPubKeyValue = signature.split(':')[0];
    const originalSignature = signature.split(':')[1];

    const signatureBuffer = Buffer.from(originalSignature, 'base64');
    const uint8Signature = new Uint8Array(signatureBuffer); // Convert the buffer to an Uint8Array
    const pubKeyValueBuffer = Buffer.from(originalPubKeyValue, 'base64'); // Decode the base64 encoded value
    const pubKeyUint8Array = new Uint8Array(pubKeyValueBuffer); // Convert the buffer to an Uint8Array
    const signedChallenge = concat([pubKeyUint8Array, uint8Signature]); // Concatenate the Uint8Arrays

    const pubKeyBytes = signedChallenge.slice(0, 33);
    const signatureBytes = signedChallenge.slice(33);

    const prefix = 'cosmos'; // change prefix for other chains...

    const isRecovered = verifyADR36Amino(
      prefix,
      originalAddress,
      originalString,
      pubKeyBytes,
      signatureBytes,
      'secp256k1'
    );

    if (!isRecovered) {
      throw `Signature invalid for address ${originalAddress}`;
    }
  }

  async verifyAssets(address: string, resources: string[], _assets: Asset<bigint>[], balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {
    let cosmosAssets: Asset<bigint>[] = []
    let bitbadgesAssets: Asset<bigint>[] = []
    if (resources) {

    }

    if (_assets) {
      cosmosAssets = _assets.filter((elem) => elem.chain === "Cosmos")
      bitbadgesAssets = _assets.filter((elem) => elem.chain === "BitBadges")
    }

    if (cosmosAssets.length === 0 && bitbadgesAssets.length === 0) return //No assets to verify

    if (bitbadgesAssets.length > 0) {
      await verifyBitBadgesAssets(bitbadgesAssets, address, balancesSnapshot)
    }

    if (cosmosAssets.length > 0) {
      throw new Error(`Ethereum assets are not yet supported`)
    }
  }
  /**
   * Currently just a boilerplate
   */
  createUniversalTxn(txn: any, message: string): UniversalTxn {
    return {
      txn,
      message,
      txnId: txn.txnId,
      nativeTxn: txn,
    };
  }
}