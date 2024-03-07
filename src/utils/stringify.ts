import { type NumberType } from 'bitbadgesjs-sdk';

export function stringifyNumber<T extends NumberType>(num: T): string {
  return BigInt(num).toString();
}
