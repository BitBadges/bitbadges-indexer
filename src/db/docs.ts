import {
  type NumberType,
  type Doc,
  type iBalance,
  BaseNumberTypeClass,
  BalanceArray,
  type iBatchBadgeDetails,
  BatchBadgeDetailsArray,
  CosmosAddress
} from 'bitbadgesjs-sdk';

export interface iPageVisitsDoc<T extends NumberType> extends Doc {
  collectionId?: T;
  listId?: string;
  lastUpdated: number;
  overallVisits: {
    daily: T;
    weekly: T;
    monthly: T;
    yearly: T;
    allTime: T;
  };
  badgePageVisits?: {
    daily: Array<iBalance<T>>;
    weekly: Array<iBalance<T>>;
    monthly: Array<iBalance<T>>;
    yearly: Array<iBalance<T>>;
    allTime: Array<iBalance<T>>;
  };
}

export class PageVisitsDoc<T extends NumberType> extends BaseNumberTypeClass<PageVisitsDoc<T>> implements iPageVisitsDoc<T> {
  _id?: string;
  _docId: string;
  collectionId?: T;
  listId?: string;
  lastUpdated: number;
  overallVisits: {
    daily: T;
    weekly: T;
    monthly: T;
    yearly: T;
    allTime: T;
  };

  badgePageVisits?: {
    daily: BalanceArray<T>;
    weekly: BalanceArray<T>;
    monthly: BalanceArray<T>;
    yearly: BalanceArray<T>;
    allTime: BalanceArray<T>;
  };

  constructor(doc: iPageVisitsDoc<T>) {
    super();
    this._id = doc._id;
    this._docId = doc._docId;
    this.collectionId = doc.collectionId;
    this.listId = doc.listId;
    this.lastUpdated = doc.lastUpdated;
    this.overallVisits = doc.overallVisits;
    this.badgePageVisits = doc.badgePageVisits
      ? {
          daily: BalanceArray.From(doc.badgePageVisits.daily),
          weekly: BalanceArray.From(doc.badgePageVisits.weekly),
          monthly: BalanceArray.From(doc.badgePageVisits.monthly),
          yearly: BalanceArray.From(doc.badgePageVisits.yearly),
          allTime: BalanceArray.From(doc.badgePageVisits.allTime)
        }
      : undefined;
  }

  getNumberFieldNames(): string[] {
    return ['collectionId', 'overallVisits'];
  }

  convert<U extends NumberType>(convertFunction: (val: NumberType) => U): PageVisitsDoc<U> {
    return super.convert(convertFunction) as PageVisitsDoc<U>;
  }
}

export interface iDigitalOceanBalancesDoc<T extends NumberType> extends Doc {
  balances: Record<string, iBalance<T>[]>;
}

export class DigitalOceanBalancesDoc<T extends NumberType>
  extends BaseNumberTypeClass<DigitalOceanBalancesDoc<T>>
  implements iDigitalOceanBalancesDoc<T>
{
  _id?: string;
  _docId: string;
  balances: Record<string, BalanceArray<T>>;

  constructor(doc: iDigitalOceanBalancesDoc<T>) {
    super();
    this._id = doc._id;
    this._docId = doc._docId;
    this.balances = Object.fromEntries(
      Object.entries(doc.balances).map(([key, value]) => {
        return [key, BalanceArray.From(value)];
      })
    );
  }

  convert<U extends NumberType>(convertFunction: (val: NumberType) => U): DigitalOceanBalancesDoc<U> {
    return super.convert(convertFunction) as DigitalOceanBalancesDoc<U>;
  }
}

export interface iBrowseDoc<T extends NumberType> extends Doc {
  collections: Record<string, T[]>;
  addressLists: Record<string, string[]>;
  profiles: Record<string, string[]>;
  badges: Record<string, Array<iBatchBadgeDetails<T>>>;
}

export class BrowseDoc<T extends NumberType> extends BaseNumberTypeClass<BrowseDoc<T>> implements iBrowseDoc<T> {
  _id?: string;
  _docId: string;
  collections: Record<string, T[]>;
  addressLists: Record<string, string[]>;
  profiles: Record<string, string[]>;
  badges: Record<string, BatchBadgeDetailsArray<T>>;

  constructor(doc: iBrowseDoc<T>) {
    super();
    this._id = doc._id;
    this._docId = doc._docId;
    this.collections = doc.collections;
    this.addressLists = doc.addressLists;
    this.profiles = doc.profiles;
    this.badges = Object.fromEntries(
      Object.entries(doc.badges).map(([key, value]) => {
        return [key, BatchBadgeDetailsArray.From(value)];
      })
    );
  }

  convert<U extends NumberType>(convertFunction: (val: NumberType) => U): BrowseDoc<U> {
    return super.convert(convertFunction) as BrowseDoc<U>;
  }
}

export interface ApiKeyDoc {
  _docId: string;
  _id?: string;
  tier?: string;
  label: string;
  apiKey: string;
  cosmosAddress: string;
  numRequests: number;
  lastRequest: number;
  createdAt: number;
  expiry: number;
  intendedUse: string;
}

export interface ReportDoc {
  _docId: string;
  _id?: string;
  collectionId?: number;
  listId?: string;
  mapId?: string;
  addressOrUsername?: string;
  reason: string;
}

export interface EthTxCountDoc {
  _docId: string;
  _id?: string;
  count: number;
  lastFetched: number;
}

export interface OffChainUrlDoc {
  _docId: string;
  _id?: string;
  collectionId: number;
  createdBy: CosmosAddress;
}
