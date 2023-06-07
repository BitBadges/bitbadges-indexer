import { NumberType } from "bitbadgesjs-proto";

export function stringifyNumber<T extends NumberType>(num: T): string {
  return BigInt(num).toString();
}