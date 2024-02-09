import { verifyADR36Amino } from '@keplr-wallet/cosmos';
import axiosApi from 'axios';
import { NumberType, OffChainBalancesMap, Stringify, SupportedChain, getChainForAddress } from 'bitbadgesjs-sdk';
import { AssetConditionGroup, CreateAssetParams, IChainDriver, UniversalTxn, constructChallengeObjectFromString } from 'blockin';
import { Buffer } from 'buffer';
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
  async verifySignature(message: string, signature: string, publicKey?: string) {
    if (!publicKey) {
      throw 'Public key is required for Cosmos';
    }

    const originalString = message;
    const originalAddress = constructChallengeObjectFromString(message, Stringify).address;

    const signatureBuffer = Buffer.from(signature, 'base64');
    const uint8Signature = new Uint8Array(signatureBuffer); // Convert the buffer to an Uint8Array

    const pubKeyValueBuffer = Buffer.from(publicKey, 'base64'); // Decode the base64 encoded value
    const pubKeyUint8Array = new Uint8Array(pubKeyValueBuffer); // Convert the buffer to an Uint8Array

    //concat the two Uint8Arrays //This is probably legacy code and can be removed
    const signedChallenge = new Uint8Array(pubKeyUint8Array.length + uint8Signature.length);
    signedChallenge.set(pubKeyUint8Array);
    signedChallenge.set(uint8Signature, pubKeyUint8Array.length);

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

  async verifyAssets(address: string, _resources: string[], assets: AssetConditionGroup<bigint> | undefined, balancesSnapshot?: OffChainBalancesMap<bigint>): Promise<any> {
    await verifyBitBadgesAssets(assets, address, balancesSnapshot)
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