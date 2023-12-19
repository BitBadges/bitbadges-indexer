import { ethers } from "ethers";

export const provider = new ethers.providers.InfuraProvider(
  'homestead',
  process.env.INFURA_API_KEY
);


export async function getNameForAddress(address: string) {
  if (ethers.utils.isAddress(address)) {
    const ensAddress = await provider.lookupAddress(address);
    if (ensAddress) return ensAddress;
  }
  return '';
}

export async function getAddressForName(name: string) {
  try {
    const resolvedAddress = await provider.resolveName(name);
    if (resolvedAddress) return resolvedAddress;
    return '';
  } catch (e) {
    return '';
  }
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
    // const twitter = await resolver.getText('com.twitter');
    // const github = await resolver.getText('com.github');
    // const discord = await resolver.getText('com.discord');
    // const telegram = await resolver.getText('org.telegram');

    return {
      avatar: ensAvatar ? ensAvatar.url : '',
      // twitter: twitter ? twitter : '',
      // github: github ? github : '',
      // discord: discord ? discord : '',
      // telegram: telegram ? telegram : '',
    };
  } catch (e) {

    return {
      avatar: '',
      // twitter: '',
      // github: '',
      // discord: '',
      // telegram: '',
    };
  }
}