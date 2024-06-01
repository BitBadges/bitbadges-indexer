import {
  BitBadgesUserInfo,
  SupportedChain,
  type iAccountDoc,
  type iProfileDoc,
  isAddressValid,
  type CosmosCoin,
  type NumberType,
  convertToEthAddress,
  convertToBtcAddress,
  type MapDoc
} from 'bitbadgesjs-sdk';
import { AddressListModel, AirdropModel, CollectionModel, ComplianceModel, EthTxCountModel, MapModel } from '../db/schemas';
import { getFromDB, insertToDB } from '../db/db';
import { client } from '../indexer-vars';
import { OFFLINE_MODE } from '../indexer-vars';
import { getEnsDetails, getEnsResolver, getNameForAddress, provider } from '../utils/ensResolvers';
import { findInDB } from '../db/queries';

export const convertToBitBadgesUserInfo = async (
  profileInfos: Array<iProfileDoc<NumberType>>,
  accountInfos: Array<iAccountDoc<NumberType> & { chain: SupportedChain }>,
  fetchName = true
): Promise<Array<BitBadgesUserInfo<NumberType>>> => {
  if (profileInfos.length !== accountInfos.length) {
    throw new Error('Account info and cosmos account details must be the same length');
  }

  if (!client) {
    throw new Error('Blockchain is not connected. This is an error on BitBadges end. Please try again later.');
  }

  const promises = [];
  for (let i = 0; i < profileInfos.length; i++) {
    const cosmosAccountInfo = accountInfos[i];
    const profileDoc = profileInfos[i];
    const isMint = accountInfos[i].cosmosAddress === 'Mint';

    promises.push(
      isMint || OFFLINE_MODE || !fetchName || (cosmosAccountInfo.pubKeyType !== 'ethsecp256k1' && cosmosAccountInfo.publicKey)
        ? { resolvedName: '' }
        : getNameAndAvatar(cosmosAccountInfo.ethAddress, !!profileDoc.profilePicUrl)
    );
    promises.push(isMint || OFFLINE_MODE ? { amount: '0', denom: 'badge' } : client.getBalance(cosmosAccountInfo.cosmosAddress, 'badge'));
    promises.push(isMint ? undefined : getFromDB(AirdropModel, cosmosAccountInfo.cosmosAddress));
    promises.push(
      isMint
        ? async () => {
            return { address: cosmosAccountInfo.cosmosAddress, chain: SupportedChain.UNKNOWN };
          }
        : async () => {
            const cosmosAddress = cosmosAccountInfo.cosmosAddress;
            const solAddress = cosmosAccountInfo.solAddress ? cosmosAccountInfo.solAddress : profileDoc?.solAddress ?? '';
            if (!isAddressValid(cosmosAddress)) {
              return {
                address: '',
                chain: SupportedChain.UNKNOWN
              };
            }

            // If we have a public key, we can determine the chain from the pub key type bc it has been previously set and used
            // This doesn't always work for Cosmos because it could be Bitcoin or Cosmos with sec256k1
            let ethTxCount = 0;
            if (cosmosAccountInfo.publicKey && cosmosAccountInfo.pubKeyType !== 'secp256k1') {
              return {
                address:
                  cosmosAccountInfo.pubKeyType === 'ethsecp256k1'
                    ? cosmosAccountInfo.ethAddress
                    : cosmosAccountInfo.pubKeyType === 'ed25519'
                      ? solAddress
                      : cosmosAccountInfo.cosmosAddress,
                chain:
                  cosmosAccountInfo.pubKeyType === 'ethsecp256k1'
                    ? SupportedChain.ETH
                    : cosmosAccountInfo.pubKeyType === 'ed25519'
                      ? SupportedChain.SOLANA
                      : SupportedChain.COSMOS
              };
            }

            // Else if we have a latestSignedInChain, we can determine the chain from that
            const ethAddress = convertToEthAddress(cosmosAccountInfo.cosmosAddress);
            if (profileDoc.latestSignedInChain != null && profileDoc.latestSignedInChain === SupportedChain.ETH) {
              return {
                address: ethAddress,
                chain: SupportedChain.ETH
              };
            } else if (profileDoc.latestSignedInChain != null && profileDoc.latestSignedInChain === SupportedChain.COSMOS) {
              return {
                address: cosmosAddress,
                chain: SupportedChain.COSMOS
              };
            } else if (profileDoc.latestSignedInChain != null && profileDoc.latestSignedInChain === SupportedChain.SOLANA) {
              return {
                address: solAddress,
                chain: SupportedChain.SOLANA
              };
            } else if (profileDoc.latestSignedInChain != null && profileDoc.latestSignedInChain === SupportedChain.BTC) {
              return {
                address: convertToBtcAddress(cosmosAddress),
                chain: SupportedChain.BTC
              };
            }

            // If we have neither, we can check if they have any transactions on the ETH chain
            const cachedEthTxCount = await getFromDB(EthTxCountModel, ethAddress);
            if (cachedEthTxCount?.count) {
              return { address: ethAddress, chain: SupportedChain.ETH };
            } else if (!cachedEthTxCount || (cachedEthTxCount && cachedEthTxCount.lastFetched < Date.now() - 1000 * 60 * 60 * 24)) {
              ethTxCount = 0;

              try {
                ethTxCount = isAddressValid(ethAddress) ? await provider.getTransactionCount(ethAddress) : 0; // handle module generated addresses
              } catch (e) {
                console.log(e);
                // we dont want the whole indexer to go down if Infura is down
              }

              await insertToDB(EthTxCountModel, {
                ...cachedEthTxCount,
                _docId: ethAddress,
                count: ethTxCount,
                lastFetched: Date.now()
              });
            }

            // Else, we default to whatever the chain was in the original account doc (which is tyically just the format of the requested address in the query)
            let defaultedAddr = cosmosAddress;
            if (accountInfos[i].chain === SupportedChain.ETH) {
              defaultedAddr = ethAddress;
            } else if (accountInfos[i].chain === SupportedChain.SOLANA) {
              defaultedAddr = solAddress;
            } else if (accountInfos[i].chain === SupportedChain.BTC) {
              defaultedAddr = convertToBtcAddress(cosmosAddress);
            }

            // Else, we check ETH txs and default to cosmos address if none
            // Should we support solana or something by default?
            return {
              address: ethTxCount > 0 ? ethAddress : defaultedAddr,
              chain: ethTxCount > 0 ? SupportedChain.ETH : accountInfos[i].chain
            };
          }
    );

    promises.push(
      cosmosAccountInfo.cosmosAddress.length <= 45
        ? Promise.resolve(undefined)
        : async () => {
            // check for aliase

            const res = await findInDB(AddressListModel, {
              query: { aliasAddress: cosmosAccountInfo.cosmosAddress },
              limit: 1
            });
            if (res.length > 0) {
              return {
                listId: res[0].listId
              };
            }

            const collectionsRes = await findInDB(CollectionModel, {
              query: { aliasAddress: cosmosAccountInfo.cosmosAddress },
              limit: 1
            });
            if (collectionsRes.length > 0) {
              return {
                collectionId: collectionsRes[0].collectionId
              };
            }

            return undefined;
          }
    );

    promises.push(getFromDB(MapModel, cosmosAccountInfo.cosmosAddress));
  }

  const results = await Promise.all(
    promises.map(async (promise) => {
      if (typeof promise === 'function') {
        return await promise();
      } else {
        return await promise;
      }
    })
  );

  const resultsToReturn: Array<BitBadgesUserInfo<NumberType>> = [];
  const complianceDoc = await getFromDB(ComplianceModel, 'compliance');
  for (let i = 0; i < results.length; i += 6) {
    const profileInfo = profileInfos[i / 6];
    const accountInfo = accountInfos[i / 6];

    const nameAndAvatarRes = results[i] as { resolvedName: string; avatar: string };
    const balanceInfo = results[i + 1] as CosmosCoin<NumberType>;
    const airdropInfo = results[i + 2] as { _docId: string; airdropped: boolean } | undefined;
    const chainResolve = results[i + 3] as { address: string; chain: SupportedChain } | undefined;
    const aliasResolve = results[i + 4] as { listId?: string; collectionId?: string } | undefined;
    const reservedMap = results[i + 5] as MapDoc<bigint> | undefined;

    const isNSFW = complianceDoc?.accounts.nsfw.find((x) => x.cosmosAddress === accountInfo.cosmosAddress);
    const isReported = complianceDoc?.accounts.reported.find((x) => x.cosmosAddress === accountInfo.cosmosAddress);

    const result = new BitBadgesUserInfo<NumberType>({
      ...profileInfo,
      ...nameAndAvatarRes,

      resolvedName: nameAndAvatarRes.resolvedName,
      // aliasResolve?.listId ? 'Alias: List ' + aliasResolve.listId :
      //   aliasResolve?.collectionId ? 'Alias: Collection ' + aliasResolve.collectionId :
      ...accountInfo,
      address: chainResolve?.address ?? '', // for ts
      chain: chainResolve?.chain ?? SupportedChain.UNKNOWN,
      alias: aliasResolve,

      balance: balanceInfo,
      airdropped: airdropInfo && airdropInfo.airdropped,
      fetchedProfile: true,

      collected: [],
      listsActivity: [],
      activity: [],
      addressLists: [],
      reviews: [],
      merkleChallenges: [],
      claimAlerts: [],
      secrets: [],
      approvalTrackers: [],
      siwbbRequests: [],
      views: {},
      nsfw: isNSFW,
      reported: isReported,
      reservedMap
    });

    resultsToReturn.push(result);
  }

  return resultsToReturn;
};

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
