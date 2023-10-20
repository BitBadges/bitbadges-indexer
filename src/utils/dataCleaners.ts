import { NumberType, JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { convertOffChainBalancesMap, isAddressValid, getChainForAddress, SupportedChain, NumberifyIfPossible, OffChainBalancesMap } from "bitbadgesjs-utils";

export function cleanMetadata(res: any): any {
  return {
    name: res.name && typeof res.name === 'string' ? res.name : '',
    description: res.description && typeof res.description === 'string' ? res.description : '',
    image: res.image && typeof res.image === 'string' ? res.image : '',
    creator: res.creator && typeof res.creator === 'string' ? res.creator : undefined,
    validFrom: res.validFrom ? [] : undefined,
    color: res.color && typeof res.color === 'string' ? res.color : undefined,
    category: res.category && typeof res.category === 'string' ? res.category : undefined,
    externalUrl: res.externalUrl && typeof res.externalUrl === 'string' ? res.externalUrl : undefined,
    tags: res.tags && Array.isArray(res.tags) && res.tags.every((tag: any) => typeof tag === 'string') ? res.tags : undefined,
  }
}

export function cleanApprovalInfo(res: any): any {
  return {
    name: res.name && typeof res.name === 'string' ? res.name : '',
    description: res.description && typeof res.description === 'string' ? res.description : '',
    hasPassword: res.hasPassword && typeof res.hasPassword === 'boolean' ? res.hasPassword : false,
    password: res.password && typeof res.password === 'string' ? res.password : undefined,
    challengeDetails: res.challengeDetails //TODO:
  }
}

export function cleanBalances(res: OffChainBalancesMap<NumberType>): OffChainBalancesMap<JSPrimitiveNumberType> {
  const newMap: OffChainBalancesMap<string> = {};
  const entries: [string, any][] = Object.entries(res);
  for (const [key, val] of entries) {
    if (isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS) {
      newMap[key] = val && Array.isArray(val)
        && val.every((balance: any) => typeof balance === 'object')
        ? val.map((balance: any) => ({
          amount: balance.amount ? BigInt(balance.amount).toString() : "0",
          badgeIds: balance.badgeIds && Array.isArray(balance.badgeIds)
            && balance.badgeIds.every((badgeId: any) => typeof badgeId === 'object')
            ? balance.badgeIds.map((badgeId: any) => ({
              start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
              end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
            })) : [],
          ownershipTimes: balance.ownershipTimes && Array.isArray(balance.ownershipTimes)
            && balance.ownershipTimes.every((badgeId: any) => typeof badgeId === 'object')
            ? balance.ownershipTimes.map((badgeId: any) => ({
              start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
              end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
            })) : [],
        })) : [];
    }
  }

  return convertOffChainBalancesMap(newMap, NumberifyIfPossible);
}