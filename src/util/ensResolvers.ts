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

export async function getEnsResolver(name: string) {
    try {
        const provider = new ethers.InfuraProvider(
            'homestead',
            process.env.INFURA_API_KEY
        );

        const ensResolver = await provider.getResolver(name);
        if (ensResolver) return ensResolver;
        return null;
    } catch (e) {
        return null;
    }
}


export async function getEnsResolversForNames(names: string[]) {
    try {
        const promises = [];

        for (const name of names) {
            promises.push(getEnsResolver(name));
        }
        const results = await Promise.all(promises);
        return results;
    } catch (e) {
        return names.map(() => null);
    }
}

export async function getEnsDetails(resolver: ethers.EnsResolver) {
    try {
        
        const ensAvatar = await resolver.getAvatar();
        // const twitter = await resolver.getText('com.twitter');
        // const github = await resolver.getText('com.github');
        // const discord = await resolver.getText('com.discord');
        // const telegram = await resolver.getText('org.telegram');

        // console.log(ensAvatar, twitter, github, discord, telegram);

        return {
            avatar: ensAvatar ? ensAvatar : '',
            // twitter: twitter ? twitter : '',
            // github: github ? github : '',
            // discord: discord ? discord : '',
            // telegram: telegram ? telegram : '',
        };
    } catch (e) {

        return {
            avatar: '',
            twitter: '',
            github: '',
            discord: '',
            telegram: '',
        };
    }
}

export async function getDetailsForNames(resolvers: ethers.EnsResolver[]) {
    const promises = [];
    for (const resolver of resolvers) {
        if (resolver) {
            promises.push(getEnsDetails(resolver));
        } else {
            promises.push(Promise.resolve({}));
        }
    }
    const details = await Promise.all(promises);
    return details;
}
