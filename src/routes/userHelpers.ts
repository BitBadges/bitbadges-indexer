import { NumberType } from "bitbadgesjs-proto";
import { AccountInfoBase, BitBadgesUserInfo, CosmosCoin, ProfileDoc, SupportedChain, cosmosToBtc, cosmosToEth, isAddressValid } from "bitbadgesjs-utils";
import { AddressMappingModel, AirdropModel, CollectionModel, EthTxCountModel, getFromDB, insertToDB } from "../db/db";
import { client } from "../indexer";
import { OFFLINE_MODE } from "../indexer-vars";
import { complianceDoc } from "../poll";
import { getEnsDetails, getEnsResolver, getNameForAddress, provider } from "../utils/ensResolvers";



export const convertToBitBadgesUserInfo = async (profileInfos: ProfileDoc<NumberType>[], accountInfos: AccountInfoBase<NumberType>[], fetchName = true): Promise<BitBadgesUserInfo<NumberType>[]> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    const profileDoc = profileInfos[i];
    let isMint = accountInfos[i].cosmosAddress === 'Mint';

    promises.push(isMint || OFFLINE_MODE || !fetchName || (cosmosAccountInfo.chain !== SupportedChain.ETH && cosmosAccountInfo.publicKey)
      ? { resolvedName: '' } : getNameAndAvatar(cosmosAccountInfo.ethAddress, !!profileDoc.profilePicUrl));
    promises.push(isMint || OFFLINE_MODE ? { amount: '0', denom: 'badge' } : client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(isMint ? undefined : getFromDB(AirdropModel, cosmosAccountInfo.cosmosAddress));
    promises.push(isMint ? async () => {
      return { address: cosmosAccountInfo.cosmosAddress, chain: SupportedChain.UNKNOWN }
    } : async () => {
      const cosmosAddress = cosmosAccountInfo.cosmosAddress;
      const solAddress = (cosmosAccountInfo.solAddress ? cosmosAccountInfo.solAddress : profileDoc?.solAddress ?? "")
      if (!isAddressValid(cosmosAddress)) {
        return {
          address: '',
          chain: SupportedChain.UNKNOWN
        }
      }

      //If we have a public key, we can determine the chain from the pub key type bc it has been previously set and used
      let ethTxCount = 0;
      if (cosmosAccountInfo.publicKey) {
        return {
          address: cosmosAccountInfo.chain === SupportedChain.ETH ? cosmosAccountInfo.ethAddress
            : cosmosAccountInfo.chain === SupportedChain.SOLANA ? solAddress
              : cosmosAccountInfo.cosmosAddress,
          chain: cosmosAccountInfo.chain
        }
      }

      //Else if we have a latestSignedInChain, we can determine the chain from that
      const ethAddress = cosmosToEth(cosmosAccountInfo.cosmosAddress);
      if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.ETH) {
        return {
          address: ethAddress,
          chain: SupportedChain.ETH
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.COSMOS) {
        return {
          address: cosmosAddress,
          chain: SupportedChain.COSMOS
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.SOLANA) {
        return {
          address: solAddress,
          chain: SupportedChain.SOLANA
        }
      } else if (profileDoc.latestSignedInChain && profileDoc.latestSignedInChain === SupportedChain.BTC) {

        return {
          address: cosmosToBtc(cosmosAddress),
          chain: SupportedChain.BTC
        }
      }

      //If we have neither, we can check if they have any transactions on the ETH chain
      const cachedEthTxCount = await getFromDB(EthTxCountModel, ethAddress);
      if (cachedEthTxCount && cachedEthTxCount.count) {
        return { address: ethAddress, chain: SupportedChain.ETH }
      } else if (!cachedEthTxCount || (cachedEthTxCount && cachedEthTxCount.lastFetched < Date.now() - 1000 * 60 * 60 * 24)) {


        ethTxCount = isAddressValid(ethAddress) ? await provider.getTransactionCount(ethAddress) : 0; //handle module generated addresses

        await insertToDB(EthTxCountModel, {
          ...cachedEthTxCount,
          _legacyId: ethAddress,
          count: ethTxCount,
          lastFetched: Date.now(),
        });
      }

      //Else, we default to whatever the chain was in the original account doc (which is tyically just the format of the requested address in the query)
      let defaultedAddr = cosmosAddress;
      if (accountInfos[i].chain === SupportedChain.ETH) {
        defaultedAddr = ethAddress;
      } else if (accountInfos[i].chain === SupportedChain.SOLANA) {
        defaultedAddr = solAddress;
      } else if (accountInfos[i].chain === SupportedChain.BTC) {
        defaultedAddr = cosmosToBtc(cosmosAddress);
      }
      //Else, we check ETH txs and default to cosmos address if none
      //Should we support solana or something by default?
      return {
        address: ethTxCount > 0 ? ethAddress : defaultedAddr,
        chain: ethTxCount > 0 ? SupportedChain.ETH : accountInfos[i].chain
      }
    });

    promises.push(cosmosAccountInfo.cosmosAddress.length <= 45 ? Promise.resolve(undefined) : async () => {
      //check for aliase

      const res = await AddressMappingModel.find({
        aliasAddress: cosmosAccountInfo.cosmosAddress,
      }).lean().limit(1).exec();
      if (res.length) {
        return {
          mappingId: res[0].mappingId
        }
      }

      const collectionsRes = await CollectionModel.find({
        aliasAddress: cosmosAccountInfo.cosmosAddress,
      }).lean().limit(1).exec();
      if (collectionsRes.length) {
        return {
          collectionId: collectionsRes[0].collectionId
        }
      }

      return undefined;
    });
  }



  const results = await Promise.all(promises.map((promise) => {
    if (typeof promise === 'function') {
      return promise();
    } else {
      return promise;
    }
  }));

  const resultsToReturn: BitBadgesUserInfo<NumberType>[] = [];

  for (let i = 0; i < results.length; i += 5) {
    const profileInfo = profileInfos[i / 5];
    const accountInfo = accountInfos[i / 5];

    const nameAndAvatarRes = results[i] as { resolvedName: string, avatar: string };
    const balanceInfo = results[i + 1] as CosmosCoin<NumberType>;
    const airdropInfo = results[i + 2] as { _legacyId: string, airdropped: boolean } | undefined;
    const chainResolve = results[i + 3] as { address: string, chain: SupportedChain } | undefined;
    const aliasResolve = results[i + 4] as { mappingId?: string, collectionId?: string } | undefined;

    const isNSFW = complianceDoc?.accounts.nsfw.find(x => x.cosmosAddress === accountInfo.cosmosAddress);
    const isReported = complianceDoc?.accounts.reported.find(x => x.cosmosAddress === accountInfo.cosmosAddress);

    resultsToReturn.push({
      ...profileInfo,
      ...nameAndAvatarRes,

      resolvedName: aliasResolve?.mappingId ? 'Alias: List ' + aliasResolve.mappingId :
        aliasResolve?.collectionId ? 'Alias: Collection ' + aliasResolve.collectionId : nameAndAvatarRes.resolvedName,
      ...accountInfo,
      address: chainResolve?.address ?? '', //for ts
      chain: chainResolve?.chain ?? '',
      alias: aliasResolve,

      balance: balanceInfo,
      airdropped: airdropInfo && airdropInfo.airdropped,
      fetchedProfile: true,

      collected: [],
      listsActivity: [],
      activity: [],
      addressMappings: [],
      announcements: [],
      reviews: [],
      merkleChallenges: [],
      claimAlerts: [],
      approvalsTrackers: [],
      authCodes: [],
      views: {},
      nsfw: isNSFW ? isNSFW : undefined,
      reported: isReported ? isReported : undefined,

      //We don't want to return these to the user
      _legacyId: accountInfo.cosmosAddress,
      _rev: undefined,
    } as BitBadgesUserInfo<NumberType>);
  }

  return resultsToReturn;
}


export async function getNameAndAvatar(address: string, skipAvatarFetch?: boolean) {
  try {
    if (!isAddressValid(address, SupportedChain.ETH)) {
      return { resolvedName: '', avatar: '' };
    }

    const ensName = await getNameForAddress(address);
    let details: { avatar?: string } = {};
    if (ensName && !skipAvatarFetch) {
      const resolver = await getEnsResolver(ensName);
      if (resolver) {
        details = await getEnsDetails(resolver);
      }
    }
    return { avatar: details.avatar, resolvedName: ensName };
  } catch (e) {
    console.log(e);
    return { resolvedName: '', avatar: '' };
  }
}
