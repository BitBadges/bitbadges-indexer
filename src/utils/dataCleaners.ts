import {
  JSPrimitiveNumberType,
  NumberType,
} from "bitbadgesjs-proto";
import {
  NumberifyIfPossible,
  OffChainBalancesMap,
  convertOffChainBalancesMap
} from "bitbadgesjs-utils";

interface Metadata {
  name?: string;
  description?: string;
  image?: string;
  creator?: string;
  validFrom?: any[]; // Update with the actual type if possible
  color?: string;
  category?: string;
  externalUrl?: string;
  tags?: string[];
}

interface ApprovalInfo {
  name?: string;
  description?: string;
  hasPassword?: boolean;
  password?: string;
  challengeDetails?: any; // Update with the actual type if possible
}

export function cleanMetadata(res: any): Metadata {
  return {
    name: typeof res.name === "string" ? res.name : "",
    description: typeof res.description === "string" ? res.description : "",
    image: typeof res.image === "string" ? res.image : "",
    creator: typeof res.creator === "string" ? res.creator : undefined,
    validFrom: res.validFrom ? [] : undefined,
    color: typeof res.color === "string" ? res.color : undefined,
    category: typeof res.category === "string" ? res.category : undefined,
    externalUrl: typeof res.externalUrl === "string" ? res.externalUrl : undefined,
    tags: Array.isArray(res.tags) && res.tags.every((tag: any) => typeof tag === "string")
      ? res.tags
      : undefined,
  };
}

export function cleanApprovalInfo(res: any): ApprovalInfo {
  return {
    name: typeof res.name === "string" ? res.name : "",
    description: typeof res.description === "string" ? res.description : "",
    hasPassword: typeof res.hasPassword === "boolean" ? res.hasPassword : false,
    password: typeof res.password === "string" ? res.password : undefined,
    challengeDetails: res.challengeDetails,
  };
}

export function cleanBalances(
  res: OffChainBalancesMap<NumberType>
): OffChainBalancesMap<JSPrimitiveNumberType> {
  const newMap: OffChainBalancesMap<string> = {};
  const entries: [string, any][] = Object.entries(res);

  for (const [key, val] of entries) {

    newMap[key] = val && Array.isArray(val) && val.every((balance: any) => typeof balance === "object")
      ? val.map((balance: any) => ({
        amount: balance.amount ? BigInt(balance.amount).toString() : "0",
        badgeIds: Array.isArray(balance.badgeIds) && balance.badgeIds.every((badgeId: any) => typeof badgeId === "object")
          ? balance.badgeIds.map((badgeId: any) => ({
            start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
            end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
          }))
          : [],
        ownershipTimes: Array.isArray(balance.ownershipTimes) && balance.ownershipTimes.every((badgeId: any) => typeof badgeId === "object")
          ? balance.ownershipTimes.map((badgeId: any) => ({
            start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
            end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
          }))
          : [],
      }))
      : [];

  }

  return convertOffChainBalancesMap(newMap, NumberifyIfPossible);
}
