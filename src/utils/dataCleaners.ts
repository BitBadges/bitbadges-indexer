import {
  BalanceArray,
  BigIntify,
  convertOffChainBalancesMap,
  type iBalance,
  type iMetadata,
  type iOffChainBalancesMap,
  type NumberType,
  type OffChainBalancesMap
} from 'bitbadgesjs-sdk';

interface ApprovalInfo {
  name?: string;
  description?: string;
  password?: string;
  challengeDetails?: any; // Update with the actual type if possible
}

export function cleanMetadata(res: any): iMetadata<NumberType> {
  return {
    name: typeof res.name === 'string' ? res.name : '',
    description: typeof res.description === 'string' ? res.description : '',
    image: typeof res.image === 'string' ? res.image : '',
    video: typeof res.video === 'string' ? res.video : '',
    category: typeof res.category === 'string' ? res.category : undefined,
    externalUrl: typeof res.externalUrl === 'string' ? res.externalUrl : undefined,
    tags: Array.isArray(res.tags) && res.tags.every((tag: any) => typeof tag === 'string') ? res.tags : undefined,
    socials: res.socials && typeof res.socials === 'object' ? res.socials : undefined,
    offChainTransferabilityInfo:
      res.offChainTransferabilityInfo && typeof res.offChainTransferabilityInfo === 'object'
        ? {
            host: res.offChainTransferabilityInfo.host,
            assignMethod: res.offChainTransferabilityInfo.assignMethod
          }
        : undefined,
    attributes: res.attributes && Array.isArray(res.attributes) ? res.attributes : undefined
  };
}

export function cleanApprovalInfo(res: any): ApprovalInfo {
  return {
    name: typeof res.name === 'string' ? res.name : '',
    description: typeof res.description === 'string' ? res.description : '',
    password: typeof res.password === 'string' ? res.password : undefined,
    challengeDetails: res.challengeDetails
  };
}

export function cleanBalanceArray(balances: any): Array<iBalance<string>> {
  return balances && Array.isArray(balances) && balances.every((balance: any) => typeof balance === 'object')
    ? balances.map((balance: any) => ({
        amount: balance.amount ? BigInt(balance.amount).toString() : '0',
        badgeIds:
          Array.isArray(balance.badgeIds) && balance.badgeIds.every((badgeId: any) => typeof badgeId === 'object')
            ? balance.badgeIds.map((badgeId: any) => ({
                start: badgeId.start ? BigInt(badgeId.start).toString() : '-1',
                end: badgeId.end ? BigInt(badgeId.end).toString() : '-1'
              }))
            : [],
        ownershipTimes:
          Array.isArray(balance.ownershipTimes) && balance.ownershipTimes.every((badgeId: any) => typeof badgeId === 'object')
            ? balance.ownershipTimes.map((badgeId: any) => ({
                start: badgeId.start ? BigInt(badgeId.start).toString() : '-1',
                end: badgeId.end ? BigInt(badgeId.end).toString() : '-1'
              }))
            : []
      }))
    : [];
}

export function cleanBalanceMap(res: iOffChainBalancesMap<NumberType>): iOffChainBalancesMap<bigint> {
  const newMap: OffChainBalancesMap<string> = {};
  const entries: Array<[string, any]> = Object.entries(res);

  for (const [key, val] of entries) {
    newMap[key] = BalanceArray.From(cleanBalanceArray(val));
  }

  return convertOffChainBalancesMap(newMap, BigIntify);
}
