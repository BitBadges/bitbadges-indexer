coneimport { SupportedChain, getChainForAddress } from "bitbadgesjs-utils"
import { Buffer } from "buffer"
import { recoverPersonalSignature } from "eth-sig-util"
import { verifyADR36Amino } from "@keplr-wallet/cosmos"
import { Keplr } from "@keplr-wallet/types"

/**
 * Cosmos implementation of the IChainDriver interface.
 *
 * For documentation regarding what each function does, see the IChainDriver interface.
 *
 * Note that the Blockin library also has many convenient, chain-generic functions that implement
 * this logic for creating / verifying challenges. Before using, you will have to setChainDriver(new CosmosDriver(.....)) first.
 */
export default class CosmosDriver {
    chain
    constructor(chain) {
        this.chain = chain
    }
    /** Boilerplates - Not Implemented Yet */
    async makeAssetTxn(assetParams) {
        throw "Not implemented"
        return this.createUniversalTxn({}, ``)
    }
    async makeAssetTransferTxn(assetParams) {
        throw "Not implemented"
        return this.createUniversalTxn({}, ``)
    }
    async sendTxn(signedTxnResult, txnId) {
        throw "Not implemented"
        return
    }
    async parseChallengeStringFromBytesToSign(txnBytes) {
        const txnString = new TextDecoder().decode(txnBytes)
        const txnString2 = Buffer.from(txnString.substring(2), "hex").toString()
        return txnString2
    }
    async lookupTransactionById(txnId) {
        throw "Not implemented"
        return
    }
    async getAssetDetails(assetId) {
        throw "Not implemented"
        return
    }
    async getAllAssetsForAddress(address) {
        throw "Not implemented"
        return
    }
    async getLastBlockIndex() {
        throw "Not implemented"
        return
    }
    async getTimestampForBlock(blockIndexStr) {
        throw "Not implemented"
        return
    }

    isValidAddress(address) {
        return getChainForAddress(address) === SupportedChain.COSMOS
    }

    /**Not implemented */
    getPublicKeyFromAddress(address) {
        throw "Not implemented"
        return new Uint8Array(0)
    }
    async verifySignature(originalChallengeToUint8Array, signedChallenge, originalAddress) {
        const originalString = await this.parseChallengeStringFromBytesToSign(originalChallengeToUint8Array)
        const pubKey = signedChallenge.slice(0, 33)
        const signature = signedChallenge.slice(33)

        const prefix = "cosmos" // change prefix for other chains...

        const isRecovered = verifyADR36Amino(
            prefix,
            originalAddress,
            originalString,
            pubKey,
            signature,
            "ethsecp256k1",
        )

        if (!isRecovered) {
            throw `Signature invalid for address ${originalAddress}`
        }
    }

    async verifyOwnershipOfAssets(address, resources, assetMinimumBalancesRequiredMap, defaultMinimum) {
        return //TODO:
    }
    /**
     * Currently just a boilerplate
     */
    createUniversalTxn(txn, message) {
        return {
            txn,
            message,
            txnId: txn.txnId,
            nativeTxn: txn,
        }
    }
}
