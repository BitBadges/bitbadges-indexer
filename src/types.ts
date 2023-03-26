//TODO: sync with bitbadges-js and the other libraries

import { Permissions } from "./bitbadges-api/permissions";
import { MerkleTree } from "merkletreejs"
export interface LatestBlockStatus {
    height: number
}

export interface BadgeUri {
    uri: string
    badgeIds: IdRange[];
}

export interface DbStatus {
    block: LatestBlockStatus
    queue: {
        startingBatchId: number,
        uri: string,
        collectionId: number,
        collection: boolean,
        badgeIds: IdRange[],
        batchId: number | 'collection',
        numCalls: number,
        specificId?: number,
        purge?: boolean
    }[]
}

export interface BadgeCollection {
    collectionId: number;
    collectionUri: string;
    badgeUris: BadgeUri[];
    bytes: string;
    manager: number;
    permissions: number;
    disallowedTransfers: TransferMapping[];
    managerApprovedTransfers: TransferMapping[];
    nextBadgeId: number;
    unmintedSupplys: Balance[];
    maxSupplys: Balance[];
    claims: Claims[];
    standard: number;
    collectionMetadata: BadgeMetadata,
    badgeMetadata: BadgeMetadataMap,
    activity: ActivityItem[];
    usedClaims: {
        [claimId: string]: {
            codes: {
                [code: string]: number;
            },
            numUsed: number,
            addresses: {
                [cosmosAddress: string]: number;
            }
        }
    };
    originalClaims: Claims[];
    managerRequests: number[];
    balances: BalancesMap;
}

export interface ActivityItem {
    method: string;
    to: number[];
    from: (number | 'Mint')[];
    balances: Balance[];
}

export interface CollectionMap {
    [collectionId: string]: BitBadgeCollection
}

export interface AccountMap {
    [cosmosAddress: string]: BitBadgesUserInfo;
}

export interface BalancesMap {
    [accountNumber: number]: UserBalance;
}

export interface BadgeMetadataMap {
    [batchId: string]: {
        badgeIds: IdRange[],
        metadata: BadgeMetadata
    }
}







export enum SupportedChain {
    ETH = 'Ethereum',
    COSMOS = 'Cosmos',
    UNKNOWN = 'Unknown'
}

export enum TransactionStatus {
    None = 0,
    AwaitingSignatureOrBroadcast = 1,
}


export interface IdRange {
    start: number;
    end: number;
}
export interface BadgeSupplyAndAmount {
    amount: number;
    supply: number;
}
export interface Balance {
    balance: number;
    badgeIds: IdRange[];
}
export interface TransferMapping {
    to: Addresses;
    from: Addresses;
}
export interface Addresses {
    accountNums: IdRange[];
    options: number;
}
export interface Transfers {
    toAddresses: number[];
    balances: Balance[];
}

export interface ClaimItem extends Claims {
    addresses: string[]; //with max uses
    addressesTree?: MerkleTree;

    codes: string[]; //with max uses
    codeTree?: MerkleTree;

    hasPassword: boolean;
}

export enum DistributionMethod {
    None,
    FirstComeFirstServe,
    Whitelist,
    Codes,
    Unminted,
}

export enum MetadataAddMethod {
    None = 'None',
    Manual = 'Manual',
    UploadUrl = 'Insert Custom Metadata Url (Advanced)',
    CSV = 'CSV',
}

export interface Claims {
    balances: Balance[];
    codeRoot: string;
    whitelistRoot: string;
    uri: string;
    timeRange: IdRange;
    limitPerAccount: number;
    amount: number;
    badgeIds: IdRange[];
    incrementIdsBy: number;
}

export interface Proof {
    total: number;
    index: number;
    leafHash: string;
    proof: string[];
}
//# sourceMappingURL=typeUtils.d.ts.map

export interface BitBadgeCollection {
    collectionId: number;
    collectionUri: string;
    badgeUri: string;
    bytes: string;
    manager: BitBadgesUserInfo;
    permissions: Permissions;
    disallowedTransfers: TransferMapping[];
    managerApprovedTransfers: TransferMapping[];
    nextBadgeId: number;
    unmintedSupplys: Balance[];
    maxSupplys: Balance[];
    claims: ClaimItem[];
    standard: number;
    collectionMetadata: BadgeMetadata,
    badgeMetadata: BadgeMetadata[],
}


export interface BalanceObject {
    balance: number,
    idRanges: IdRange[]
}

export interface BitBadgeMintObject {
    standard?: number;
    permissions?: number;
    metadata?: BadgeMetadata;
    badgeSupplys?: SubassetSupply[];
}

export interface GetBalanceResponse {
    error?: any;
    balance?: UserBalance;
}

export interface UserBalance {
    balances: Balance[];
    approvals: Approval[];
}

export interface Approval {
    address: number;
    balances: Balance[];
}

export interface PendingTransfer {
    subbadgeRange: IdRange;
    thisPendingNonce: number;
    otherPendingNonce: number;
    amount: number;
    sent: boolean;
    to: number;
    from: number;
    approvedBy: number;
    markedAsAccepted: boolean;
    expirationTime: number;
    cantCancelBeforeTime: number;
}


export interface BadgeMetadata {
    name: string;
    description: string;
    image: string;
    creator?: string;
    validFrom?: IdRange;
    color?: string;
    type?: number;
    category?: string;
    externalUrl?: string;
    tags?: string[];
}

export interface SubassetSupply {
    supply: number;
    amount: number;
}

export interface CosmosAccountInformation {
    account_number: number;
    sequence: number;
    pub_key: {
        key: string;
    }
    address: string;
}

export interface BitBadgesUserInfo {
    cosmosAddress: string,
    accountNumber: number,
    chain: string,
    address: string,
    name?: string
}

