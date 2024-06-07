import { BigIntify, convertOffChainBalancesMap, type iOffChainBalancesMap, type NumberType } from 'bitbadgesjs-sdk';

export function cleanBalanceMap(res: iOffChainBalancesMap<NumberType>): iOffChainBalancesMap<bigint> {
  return convertOffChainBalancesMap(res, BigIntify);
}
