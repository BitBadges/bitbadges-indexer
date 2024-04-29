import {
  AddressList,
  BalanceArray,
  BigIntify,
  UintRangeArray,
  convertToCosmosAddress,
  getBalancesForIds,
  mustConvertToEthAddress,
  type UintRange
} from 'bitbadgesjs-sdk';
import { type AndGroup, type AssetConditionGroup, type OrGroup, type OwnershipRequirements } from 'blockin';
import Moralis from 'moralis';
import { getBalanceForAddress } from '../routes/balances';
import { getAddressListsFromDB } from '../routes/utils';
import { Request } from 'express';

export async function verifyBitBadgesAssets(
  bitbadgesAssets: AssetConditionGroup<bigint> | undefined,
  address: string,
  balancesSnapshot?: Record<string, Record<string, BalanceArray<bigint>>>
) {
  if (!bitbadgesAssets) return;

  const andItem: AndGroup<bigint> = bitbadgesAssets as AndGroup<bigint>;
  const orItem: OrGroup<bigint> = bitbadgesAssets as OrGroup<bigint>;
  const normalItem: OwnershipRequirements<bigint> = bitbadgesAssets as OwnershipRequirements<bigint>;

  if (andItem.$and) {
    for (const item of andItem.$and) {
      await verifyBitBadgesAssets(item, address, balancesSnapshot);
    }
  } else if (orItem.$or) {
    for (const item of orItem.$or) {
      try {
        await verifyBitBadgesAssets(item, address, balancesSnapshot);
        return; // if we get here, we are good (short circuit)
      } catch (e) {
        continue;
      }
    }

    throw new Error('Address did not meet the asset ownership requirements.');
  } else {
    const supportedChains = ['BitBadges', 'Ethereum', 'Polygon'];
    const evmChains = ['Ethereum', 'Polygon'];

    // Validate basic checks
    for (const asset of normalItem.assets) {
      // Validate BitBadges Lists
      if (asset.collectionId === 'BitBadges Lists') {
        if (asset.mustOwnAmounts && !(asset.mustOwnAmounts.start === 1n || asset.mustOwnAmounts.start === 0n)) {
          throw new Error('mustOwnAmount must be 0 or 1 for BitBadges Lists');
        }

        if (asset.mustOwnAmounts && asset.mustOwnAmounts.start !== asset.mustOwnAmounts.end) {
          throw new Error('mustOwnAmount must be the same start and end for BitBadges Lists (x0-0 or x1-1)');
        }

        if (!asset.assetIds.every((x) => typeof x === 'string')) {
          throw new Error('For "BitBadges Lists" collection, all assetIds must be the list IDs as strings');
        }
      }

      // Validate BitBadges
      if (asset.chain === 'BitBadges' && asset.collectionId !== 'BitBadges Lists') {
        if (!asset.assetIds.every((x) => typeof x === 'object' && BigInt(x.start) >= 0 && BigInt(x.end) >= 0)) {
          throw new Error('All assetIds must be UintRanges for BitBadges compatibility');
        }
      }

      // Validate EVM
      if (evmChains.includes(asset.chain)) {
        if (asset.ownershipTimes && asset.ownershipTimes.length > 0) {
          throw new Error(`Ownership times not supported for Ethereum assets`);
        }

        if (!asset.assetIds.every((x) => typeof x === 'string')) {
          throw new Error(`All assetIds must be strings for Ethereum compatibility`);
        }
      }

      // Applicable to all
      if (!supportedChains.includes(asset.chain)) {
        throw new Error('Only BitBadges, Ethereum, and Polygon assets are supported');
      }

      if (!asset.mustOwnAmounts || !asset.collectionId || !asset.assetIds) {
        throw new Error('All assets must have collectionId, assetIds, and mustOwnAmounts');
      }

      if (!(typeof asset.mustOwnAmounts === 'object' && BigInt(asset.mustOwnAmounts.start) >= 0 && BigInt(asset.mustOwnAmounts.end) >= 0)) {
        throw new Error(`mustOwnAmount must be UintRange for compatibility`);
      }

      if (!asset.ownershipTimes || asset.ownershipTimes.length === 0) {
        asset.ownershipTimes = [{ start: BigInt(Date.now()), end: BigInt(Date.now()) }];
      }

      if (asset.ownershipTimes && !asset.ownershipTimes.every((x) => typeof x === 'object' && BigInt(x.start) >= 0 && BigInt(x.end) >= 0)) {
        throw new Error('All ownershipTimes must be UintRanges for BitBadges compatibility');
      }

      if (balancesSnapshot && (asset.chain !== 'BitBadges' || asset.collectionId === 'BitBadges Lists')) {
        throw new Error('Balances snapshot only supported for BitBadges badges');
      }
    }

    let numToSatisfy = BigInt(normalItem.options?.numMatchesForVerification ?? 0n);
    const mustSatisfyAll = !numToSatisfy;
    if (!numToSatisfy) {
      for (const asset of normalItem.assets) {
        if (asset.collectionId === 'BitBadges Lists' || asset.chain !== 'BitBadges') {
          numToSatisfy += BigInt(asset.assetIds.length); // string[]
        } else {
          // UintRange[]
          numToSatisfy += UintRangeArray.From(asset.assetIds.map((x) => x as UintRange<bigint>))
            .convert(BigIntify)
            .size();
        }
      }
    }

    let numSatisfied = 0n;
    for (const asset of normalItem.assets) {
      let balances = new BalanceArray<bigint>();

      if (evmChains.includes(asset.chain)) {
        let moralisChainId = '0x1';
        if (asset.chain === 'Polygon') {
          moralisChainId = '0x89';
        }

        const options = {
          chain: moralisChainId,
          address: mustConvertToEthAddress(address)
        };
        const assetsForAddress = (await Moralis.EvmApi.nft.getWalletNFTs(options)).result;

        // little hacky but makes it compatible with UintRange interface
        // Each assetId is imply mapped to a numeric badge ID
        for (let i = 0; i < asset.assetIds.length; i++) {
          const assetId = asset.assetIds[i];
          const badgeId = BigInt(i + 1);
          const requestedAsset = assetsForAddress?.find(
            (elem) => elem.tokenAddress.toJSON() === asset.collectionId && elem.tokenId.toString() === assetId
          );
          const amount = requestedAsset?.amount ? BigInt(requestedAsset?.amount) : BigInt(0);

          balances.addBalance({
            amount,
            badgeIds: [{ start: badgeId, end: badgeId }],
            ownershipTimes: asset.ownershipTimes
          });
        }

        // Little hacky but the addBalances do not include zero balances but the getBalancesForIds does
        balances = getBalancesForIds([{ start: 1n, end: BigInt(asset.assetIds.length) }], asset.ownershipTimes, balances);
      } else if (asset.collectionId === 'BitBadges Lists') {
        // Little hacky but it works
        const res = await getAddressListsFromDB(
          (asset.assetIds as string[]).map((x) => ({ listId: x })),
          false
        );

        for (let i = 0; i < res.length; i++) {
          const list = res[i];
          const badgeId = BigInt(i + 1);
          if (!list) {
            throw new Error('Could not find list in DB');
          }

          list.addresses = list.addresses.map((x) => convertToCosmosAddress(x));
          balances.addBalances([
            {
              badgeIds: [{ start: badgeId, end: badgeId }],
              amount: new AddressList(list).checkAddress(convertToCosmosAddress(address)) ? 1n : 0n,
              ownershipTimes: [{ start: 1n, end: BigInt('18446744073709551615') }]
            }
          ]);
        }

        // Little hacky but the addBalances do not include zero balances but the getBalancesForIds does
        balances = getBalancesForIds([{ start: 1n, end: BigInt(res.length) }], asset.ownershipTimes, balances);
      } else {
        let docBalances = new BalanceArray<bigint>();
        if (!balancesSnapshot) {
          const req: Request = {} as Request;
          const balanceDoc = await getBalanceForAddress(req, Number(asset.collectionId), address);

          if (!balanceDoc) {
            throw new Error(`Error fetching balance for collection ${asset.collectionId} and address ${address}`); //Should return a doc even if owns x0
          } else {
            docBalances = balanceDoc.balances.clone();
          }
        } else {
          const collectionId = asset.collectionId.toString();
          const cosmosAddress = convertToCosmosAddress(address);
          docBalances.addBalances(balancesSnapshot[`${collectionId}`]?.[`${cosmosAddress}`] ?? []);
        }

        balances = getBalancesForIds(
          asset.assetIds.map((x) => x as UintRange<bigint>),
          asset.ownershipTimes,
          docBalances
        );
      }

      const mustOwnAmount = asset.mustOwnAmounts;

      for (const balance of balances) {
        if (balance.amount < mustOwnAmount.start) {
          if (mustSatisfyAll) {
            if (asset.collectionId === 'BitBadges Lists') {
              const listIdIdx = balance.badgeIds[0].start - 1n;
              const correspondingListId = asset.assetIds[Number(listIdIdx)] as string;
              throw new Error(`Address ${address} does not meet the requirements for list ${correspondingListId.toString()}`);
            } else {
              throw new Error(
                `Address ${address} does not own enough of IDs ${balance.badgeIds.map((x) => `${x.start}-${x.end}`).join(',')} from collection ${
                  asset.collectionId
                } to meet minimum balance requirement of ${mustOwnAmount.start}`
              );
            }
          } else {
            continue;
          }
        }

        if (balance.amount > mustOwnAmount.end) {
          if (mustSatisfyAll) {
            if (asset.collectionId === 'BitBadges Lists') {
              const listIdIdx = balance.badgeIds[0].start - 1n;
              const correspondingListId = asset.assetIds[Number(listIdIdx)] as string;
              throw new Error(`Address ${address} does not meet requirements for list ${correspondingListId.toString()}`);
            } else {
              throw new Error(
                `Address ${address} owns too much of IDs ${balance.badgeIds.map((x) => `${x.start}-${x.end}`).join(',')} from collection ${
                  asset.collectionId
                } to meet maximum balance requirement of ${mustOwnAmount.end}`
              );
            }
          } else {
            continue;
          }
        }

        numSatisfied += balance.badgeIds.size();
      }
    }

    if (numSatisfied < numToSatisfy) {
      throw new Error(`Address ${address} did not meet the ownership requirements.`);
    }
  }
}
