import { ethers } from "ethers";

export async function getNamesForAddresses(addresses: string[]) {
    const promises = [];
    for (const address of addresses) {
        promises.push(getNameForAddress(address));
    }
    const names = await Promise.all(promises);
    return names;
}

export async function getAddressesForNames(names: string[]) {
    const promises = [];
    for (const name of names) {
        promises.push(getAddressForName(name));
    }
    const addresses = await Promise.all(promises);
    return addresses;
}

export async function getNameForAddress(address: string) {
    const provider = new ethers.InfuraProvider(
        'homestead',
        process.env.INFURA_API_KEY
    );

    if (ethers.isAddress(address)) {
        const ensAddress = await provider.lookupAddress(address);
        if (ensAddress) return ensAddress;
    }
    return '';
}

export async function getAddressForName(name: string) {
    try {
        const provider = new ethers.InfuraProvider(
            'homestead',
            process.env.INFURA_API_KEY
        );

        const resolvedAddress = await provider.resolveName(name);
        if (resolvedAddress) return resolvedAddress;
        return '';
    } catch (e) {
        return '';
    }
}

export async function getEnsAvatar(name: string) {
    try {
        const provider = new ethers.InfuraProvider(
            'homestead',
            process.env.INFURA_API_KEY
        );

        console.log("name: ", name);
        const ensAvatar = await provider.getAvatar(name);
        console.log("ensAvatar: ", ensAvatar);
        if (ensAvatar) return ensAvatar;
        return '';
    } catch (e) {
        return '';
    }
}


export async function getAvatarsForNames(names: string[]) {
    const promises = [];
    for (const name of names) {
        if (name) {
            promises.push(getEnsAvatar(name));
        } else {
            promises.push(Promise.resolve(''));
        }
    }
    const avatars = await Promise.all(promises);
    return avatars;
}
