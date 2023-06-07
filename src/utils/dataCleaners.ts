import { NumberType, JSPrimitiveNumberType } from "bitbadgesjs-proto";
import { BalancesMap, isAddressValid, getChainForAddress, SupportedChain, convertBalancesMap, NumberifyIfPossible } from "bitbadgesjs-utils";

export function cleanMetadata(res: any): any {
  return {
    name: res.name && typeof res.name === 'string' ? res.name : '',
    description: res.description && typeof res.name === 'string' ? res.description : '',
    // image: res.image, //We do not want to store the image in the DB
    creator: res.creator && typeof res.name === 'string' ? res.creator : undefined,
    validFrom: res.validFrom ? {
      start: res.validFrom.start ? BigInt(res.validFrom.start).toString() : "-1",
      end: res.validFrom.end ? BigInt(res.validFrom.end).toString() : "-1",
    } : undefined,
    color: res.color && typeof res.name === 'string' ? res.color : undefined,
    category: res.category && typeof res.name === 'string' ? res.category : undefined,
    externalUrl: res.externalUrl && typeof res.name === 'string' ? res.externalUrl : undefined,
    tags: res.tags && Array.isArray(res.tags) && res.tags.every((tag: any) => typeof tag === 'string') ? res.tags : undefined,
  }
}

export function cleanClaims(res: any): any {
  return {
    name: res.name && typeof res.name === 'string' ? res.name : '',
    description: res.description && typeof res.name === 'string' ? res.description : '',
    hasPassword: res.hasPassword && typeof res.hasPassword === 'boolean' ? res.hasPassword : false,
    password: res.password && typeof res.password === 'string' ? res.password : undefined,
    challengeDetails: res.challengeDetails
      && Array.isArray(res.challengeDetails)
      && res.challengeDetails.every((challenge: any) => typeof challenge === 'object')
      && res.challengeDetails.every((challenge: any) => typeof challenge.leavesDetails === 'object'
        && typeof challenge.leavesDetails.isHashed === 'boolean' && Array.isArray(challenge.leavesDetails.leaves)
        && challenge.leavesDetails.leaves.every((leaf: any) => typeof leaf === 'string'))
      ? res.challengeDetails.map((challenge: any) => ({
        leavesDetails: {
          isHashed: challenge.leavesDetails.isHashed,
          leaves: challenge.leavesDetails.leaves,
        }
      })) : undefined,
  }
}

export function cleanBalances(res: BalancesMap<NumberType>): BalancesMap<JSPrimitiveNumberType> {
  const newMap: BalancesMap<string> = {};
  const entries: [string, any][] = Object.entries(res);
  for (const [key, val] of entries) {
    if (isAddressValid(key) && getChainForAddress(key) === SupportedChain.COSMOS) {
      newMap[key] = {
        balances: val.balances && Array.isArray(val.balances)
          && val.balances.every((balance: any) => typeof balance === 'object')
          ? val.balances.map((balance: any) => ({
            amount: balance.amount ? BigInt(balance.amount).toString() : "0",
            badgeIds: balance.badgeIds && Array.isArray(balance.badgeIds)
              && balance.badgeIds.every((badgeId: any) => typeof badgeId === 'object')
              ? balance.badgeIds.map((badgeId: any) => ({
                start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
                end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
              })) : [],
          })) : [],
        approvals: val.approvals && Array.isArray(val.approvals)
          && val.approvals.every((balance: any) => typeof balance === 'object')
          ? val.approvals.map((balance: any) => ({
            amount: balance.amount ? BigInt(balance.amount).toString() : "0",
            badgeIds: balance.badgeIds && Array.isArray(balance.badgeIds)
              && balance.badgeIds.every((badgeId: any) => typeof badgeId === 'object')
              ? balance.badgeIds.map((badgeId: any) => ({
                start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
                end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
              })) : [],
          })) : [],

      }
    }
  }

  return convertBalancesMap(newMap, NumberifyIfPossible);
}