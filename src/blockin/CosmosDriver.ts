import { verifyADR36Amino } from '@keplr-wallet/cosmos';
import axiosApi from 'axios';
import { Balance, Stringify, UintRange, convertBalance, convertUintRange } from 'bitbadgesjs-proto';
import { BigIntify, GetBadgeBalanceByAddressRoute, GetBadgeBalanceByAddressRouteSuccessResponse, NumberType, OffChainBalancesMap, SupportedChain, convertToCosmosAddress, getBalancesForIds, getChainForAddress } from 'bitbadgesjs-utils';
import { CreateAssetParams, IChainDriver, UniversalTxn, constructChallengeObjectFromString } from 'blockin';
import { Asset } from 'blockin';
import { Buffer } from 'buffer';
import { concat } from 'ethers/lib/utils';

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

  async verifyAssets(address: string, resources: string[], _assets: Asset<NumberType>[], balancesSnapshot?: object): Promise<any> {

    let ethAssets: Asset<NumberType>[] = []
    let bitbadgesAssets: Asset<NumberType>[] = []
    if (resources) {

    }

    if (_assets) {
      bitbadgesAssets = _assets.filter((elem) => elem.chain === "BitBadges")
    }

    if (ethAssets.length === 0 && bitbadgesAssets.length === 0) return //No assets to verify

    if (bitbadgesAssets.length > 0) {
      for (const asset of bitbadgesAssets) {
        let docBalances: Balance<bigint>[] = []
        if (!balancesSnapshot) {
          const balancesRes: GetBadgeBalanceByAddressRouteSuccessResponse<string> = await axios.post(
            "https://api.bitbadges.io" +
            GetBadgeBalanceByAddressRoute(asset.collectionId, convertToCosmosAddress(address),),
            {},
            {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.BITBADGES_API_KEY,
              },
            },
          ).then((res) => {
            return res.data
          })

          docBalances = balancesRes.balance.balances.map((x) => convertBalance(x, BigIntify))
        } else {
          const cosmosAddress = convertToCosmosAddress(address)
          const balancesSnapshotObj = balancesSnapshot as OffChainBalancesMap<bigint>
          docBalances = balancesSnapshotObj[cosmosAddress] ? balancesSnapshotObj[cosmosAddress].map(x => convertBalance(x, BigIntify)) : []
        }

        if (
          !asset.assetIds.every(
            (x) => typeof x === "object" && BigInt(x.start) >= 0 && BigInt(x.end) >= 0,
          )
        ) {
          throw new Error(`All assetIds must be UintRanges for BitBadges compatibility`)
        }

        if (
          asset.ownershipTimes &&
          !asset.ownershipTimes.every(
            (x) => typeof x === "object" && BigInt(x.start) >= 0 && BigInt(x.end) >= 0,
          )
        ) {
          throw new Error(`All ownershipTimes must be UintRanges for BitBadges compatibility`)
        }

        if (
          asset.mustOwnAmounts && !(typeof asset.mustOwnAmounts === "object" && BigInt(asset.mustOwnAmounts.start) >= 0 && BigInt(asset.mustOwnAmounts.end) >= 0)
        ) {
          throw new Error(`mustOwnAmount must be UintRange for BitBadges compatibility`)
        }

        if (!asset.ownershipTimes) {
          asset.ownershipTimes = [{ start: BigInt(Date.now()), end: BigInt(Date.now()) }]
        }

        const balances = getBalancesForIds(
          asset.assetIds.map((x) => convertUintRange(x as UintRange<bigint>, BigIntify)),
          asset.ownershipTimes.map((x) => convertUintRange(x, BigIntify)),
          docBalances,
        )

        const mustOwnAmount = asset.mustOwnAmounts
        for (const balance of balances) {
          if (BigInt(balance.amount) < BigInt(mustOwnAmount.start)) {
            throw new Error(
              `Address ${address} does not own enough of IDs ${balance.badgeIds
                .map((x) => `${x.start}-${x.end}`)
                .join(",")} from collection ${asset.collectionId
              } to meet minimum balance requirement of ${mustOwnAmount.start}`,
            )
          }

          if (BigInt(balance.amount) > BigInt(mustOwnAmount.end)) {
            throw new Error(
              `Address ${address} owns too much of IDs ${balance.badgeIds
                .map((x) => `${x.start}-${x.end}`)
                .join(",")} from collection ${asset.collectionId
              } to meet maximum balance requirement of ${mustOwnAmount.end}`,
            )
          }

        }
      }
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