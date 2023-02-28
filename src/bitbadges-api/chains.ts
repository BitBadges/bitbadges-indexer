import { COSMOS, ethToCosmos } from "bitbadgesjs-address-converter";
import { BitBadgesUserInfo, SupportedChain } from "../types";
import { ethers } from "ethers";

export const MINT_ACCOUNT: BitBadgesUserInfo = {
    cosmosAddress: '',
    accountNumber: -1,
    address: 'Mint',
    chain: SupportedChain.COSMOS
}


export function convertToCosmosAddress(address: string) {
    let bech32Address = '';
    try {
        COSMOS.decoder(address);
        bech32Address = address;
    } catch {
        if (ethers.isAddress(address)) {
            bech32Address = ethToCosmos(address);
        }
    }

    return bech32Address;
}

export function getChainForAddress(address: string) {
    try {
        COSMOS.decoder(address);
        return SupportedChain.COSMOS;
    } catch {
        if (ethers.isAddress(address)) {
            return SupportedChain.ETH;
        }
    }

    let addr: string = address;
    if (addr.startsWith('0x')) {
        return SupportedChain.ETH;
    } else if (addr.startsWith('cosmos')) {
        return SupportedChain.COSMOS;
    }

    return SupportedChain.UNKNOWN;
}

export function getAbbreviatedAddress(address: string) {
    let isMintAddress = address === MINT_ACCOUNT.address;
    if (isMintAddress) return 'Mint';
    if (address.length == 0) return '...';
    if (address.length < 13) return address;

    return address.substring(0, 10) + '...' + address.substring(address.length - 4, address.length);
}

export function isAddressValid(address: string, chain?: string) {
    let isValidAddress = true;

    if (chain == undefined || chain == SupportedChain.UNKNOWN) {
        chain = getChainForAddress(address);
    }

    switch (chain) {
        case SupportedChain.ETH:
        case SupportedChain.UNKNOWN:
            isValidAddress = ethers.isAddress(address);
            break;
        case SupportedChain.COSMOS:
            try {
                COSMOS.decoder(address);
            } catch {
                isValidAddress = false;
            }
            break;
        default:
            isValidAddress = false;
            break;
    }

    if (address === MINT_ACCOUNT.address) {
        isValidAddress = true;
    }

    return isValidAddress;
}