import { ethers } from 'ethers';

export const provider = new ethers.providers.InfuraProvider('homestead', process.env.INFURA_API_KEY);

export async function getNameForAddress(address: string) {
  if (ethers.utils.isAddress(address)) {
    const ensAddress = await provider.lookupAddress(address);
    if (ensAddress) return ensAddress;
  }
  return '';
}

export async function getAddressForName(name: string) {
  return (await provider.resolveName(name).catch(() => '')) ?? '';
}

export async function getEnsResolver(name: string) {
  try {
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

export async function getEnsDetails(resolver: ethers.providers.Resolver) {
  try {
    const ensAvatar = await resolver.getAvatar();
    return {
      avatar: ensAvatar ? ensAvatar.url : ''
    };
  } catch (e) {
    return {
      avatar: ''
    };
  }
}
