import { recoverPersonalSignature } from "eth-sig-util"
import { ethers } from "ethers"
import Moralis from "moralis/node.js"
import { Buffer } from "buffer"
/**
 * Ethereum implementation of the IChainDriver interface. This implementation is based off the Moralis API
 * and ethers.js library.
 *
 * For documentation regarding what each function does, see the IChainDriver interface.
 *
 * Note that the Blockin library also has many convenient, chain-generic functions that implement
 * this logic for creating / verifying challenges. Before using,ou will have to setChainDriver(new EthDriver(.....)) first.
 */
export default class EthDriver {
    moralisDetails
    chain
    constructor(chain, MORALIS_DETAILS) {
        this.moralisDetails = MORALIS_DETAILS
            ? MORALIS_DETAILS
            : {
                  serverUrl: "",
                  appId: "",
                  masterKey: "",
              }
        if (MORALIS_DETAILS) Moralis.start(this.moralisDetails)
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
        const options = {
            chain: this.chain,
            transaction_hash: txnId,
        }
        const transaction = await Moralis.Web3API.native.getTransaction(options)
        return transaction
    }
    async getAssetDetails(assetId) {
        const options = {
            chain: this.chain,
            addresses: [`${assetId}`],
        }
        const tokenMetadata = await Moralis.Web3API.token.getTokenMetadata(options)
        return tokenMetadata
    }
    async getAllAssetsForAddress(address) {
        const options = {
            chain: this.chain,
            address,
        }
        const accountAssets = await Moralis.Web3API.account.getNFTs(options)
        return accountAssets["result"]
    }
    async getLastBlockIndex() {
        const lastBlock = await Moralis.Web3API.native.getDateToBlock({
            date: `${new Date()}`,
        })
        const lastBlockHash = lastBlock["block"]
        const options = {
            chain: this.chain,
            block_number_or_hash: `${lastBlockHash}`,
        }
        // get block content on BSC
        const transactions = await Moralis.Web3API.native.getBlock(options)
        return transactions["hash"]
    }
    async getTimestampForBlock(blockIndexStr) {
        const options = {
            chain: this.chain,
            block_number_or_hash: `${blockIndexStr}`,
        }
        const transactions = await Moralis.Web3API.native.getBlock(options)
        return transactions["timestamp"]
    }
    isValidAddress(address) {
        return ethers.utils.isAddress(address)
    }
    /**Not implemented */
    getPublicKeyFromAddress(address) {
        throw "Not implemented"
        return new Uint8Array(0)
    }
    async verifySignature(originalChallengeToUint8Array, signedChallenge, originalAddress) {
        const original = new TextDecoder().decode(originalChallengeToUint8Array)
        const signed = new TextDecoder().decode(signedChallenge)
        const recoveredAddr = recoverPersonalSignature({
            data: original,
            sig: signed,
        })
        if (recoveredAddr.toLowerCase() !== originalAddress.toLowerCase()) {
            throw `Signature Invalid: Expected ${originalAddress} but got ${recoveredAddr}`
        }
    }
    async verifyOwnershipOfAssets(address, resources, assetMinimumBalancesRequiredMap, defaultMinimum) {
        if (!resources || resources.length == 0) return
        let assetIds = []
        if (resources) {
            const filteredAssetIds = resources.filter((elem) => elem.startsWith("Asset ID: "))
            for (const assetStr of filteredAssetIds) {
                const assetId = assetStr.substring(10)
                assetIds.push(assetId)
            }
        }
        if (assetIds.length === 0) return
        const options = {
            chain: this.chain,
            address,
        }
        const assets = (await Moralis.Web3API.account.getNFTs(options)).result
        const assetLookupData = {
            assetsForAddress: assets,
            address,
        }
        for (let i = 0; i < assetIds.length; i++) {
            const assetId = assetIds[i]
            const defaultBalance = defaultMinimum ? defaultMinimum : 1
            const minimumAmount =
                assetMinimumBalancesRequiredMap && assetMinimumBalancesRequiredMap[assetId]
                    ? assetMinimumBalancesRequiredMap[assetId]
                    : defaultBalance
            const requestedAsset = assets?.find((elem) => elem["token_address"].toString() === assetId)
            if (!requestedAsset) {
                throw `Address ${address} does not own requested asset : ${assetId}`
            }
            console.log(`Success: Found asset in user's wallet: ${assetId}.`)
            console.log("ASSET DETAILS", requestedAsset)
            if (requestedAsset["amount"] && requestedAsset["amount"] < minimumAmount) {
                throw `Address ${address} only owns ${requestedAsset["amount"]} and does not meet minimum balance requirement of ${minimumAmount} for asset : ${assetId}`
            }
        }
        return assetLookupData
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
