import { JSPrimitiveNumberType, NumberType } from 'bitbadgesjs-proto';
import { AccountDoc, AccountInfoBase, ActivityInfoBase, AddressMappingDoc, AirdropDoc, AirdropInfoBase, AnnouncementDoc, AnnouncementInfoBase, ApprovalsTrackerDoc, BalanceDoc, BalanceInfoBase, BlockinAuthSignatureDoc, ClaimAlertDoc, CollectionDoc, CollectionInfoBase, ComplianceDoc, ErrorDoc, FetchDoc, FetchInfoBase, IPFSTotalsDoc, IPFSTotalsInfoBase, MerkleChallengeDoc, MerkleChallengeInfoBase, NumberifyIfPossible, PasswordDoc, PasswordInfoBase, ProfileDoc, ProfileInfoBase, QueueDoc, QueueInfoBase, RefreshDoc, RefreshInfoBase, ReviewDoc, ReviewInfoBase, StatusDoc, StatusInfoBase, TransferActivityDoc, TransferActivityInfoBase, convertAccountDoc, convertAddressMappingDoc, convertAirdropDoc, convertAnnouncementDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertBlockinAuthSignatureDoc, convertClaimAlertDoc, convertCollectionDoc, convertComplianceDoc, convertFetchDoc, convertIPFSTotalsDoc, convertMerkleChallengeDoc, convertPasswordDoc, convertProfileDoc, convertQueueDoc, convertRefreshDoc, convertReviewDoc, convertStatusDoc, convertTransferActivityDoc } from "bitbadgesjs-utils";
import { config } from "dotenv";
import Nano from "nano";

config();

const LocalNano = Nano(`${process.env.DB_URL}`);
// const LocalNano = Nano(`${process.env.CLUSTERED_DB_URL}`);


export interface ApiKeyDoc {
  numRequests: number;
  lastRequest: number;
}

export interface ReportDoc {
  collectionId?: number;
  mappingId?: string;
  addressOrUsername?: string;
  reason: string;
}

export interface EthTxCountDoc {
  count: number;
  lastFetched: number;
}

export interface MsgDoc {
  msg?: any;
  type: string;
  txHash: string;
  txIndex: number;
  msgIndex: number;
  block: number;
  blockTimestamp: number;
  collectionId?: bigint;
  creator?: string;
}

export interface OffChainUrlDoc {
  collectionId: number;
}

export type BitBadgesDocumentBase<T extends NumberType> = TransferActivityInfoBase<T> | ReviewInfoBase<T> | AnnouncementInfoBase<T> | ActivityInfoBase<T> | ProfileInfoBase<T> | AccountInfoBase<T> | CollectionInfoBase<T> | StatusInfoBase<T> | PasswordInfoBase<T> | BalanceInfoBase<T> | MerkleChallengeInfoBase<T> | FetchInfoBase<T> | QueueInfoBase<T> | RefreshInfoBase<T> | IPFSTotalsInfoBase<T> | ErrorDoc | AirdropInfoBase<T> | ApprovalsTrackerDoc<T> | AddressMappingDoc<T> | ApiKeyDoc | ClaimAlertDoc<T> | EthTxCountDoc | MsgDoc | OffChainUrlDoc | ReportDoc | ComplianceDoc<T> | BlockinAuthSignatureDoc<T>  | SurveyDoc

//Fetches / Queue stuff - ClusteredNano
export const FETCHES_DB = LocalNano.db.use<FetchDoc<JSPrimitiveNumberType>>('fetches');
export const QUEUE_DB = LocalNano.db.use<QueueDoc<JSPrimitiveNumberType>>('queue');
// export const OFF_CHAIN_BALANCES_DB = LocalNano.db.use<BalanceDoc<JSPrimitiveNumberType>>('balances');
// export const OFF_CHAIN_TRANSFER_ACTIVITY = LocalNano.db.use<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activity');
export const REFRESHES_DB = LocalNano.db.use<RefreshDoc<JSPrimitiveNumberType>>('refreshes');
//load balancer???


//Local Deterministic from BC - Deterministic Cluster????
export const OFF_CHAIN_URLS_DB = LocalNano.db.use<OffChainUrlDoc>('off-chain-urls');
export const COLLECTIONS_DB = LocalNano.db.use<CollectionDoc<JSPrimitiveNumberType>>('collections');
export const STATUS_DB = LocalNano.db.use<StatusDoc<JSPrimitiveNumberType>>('status');
export const ACCOUNTS_DB = LocalNano.db.use<AccountDoc<JSPrimitiveNumberType>>('accounts');
export const APPROVALS_TRACKER_DB = LocalNano.db.use<ApprovalsTrackerDoc<JSPrimitiveNumberType>>('approvals-trackers');
export const ADDRESS_MAPPINGS_DB = LocalNano.db.use<AddressMappingDoc<JSPrimitiveNumberType>>('address-mappings');
export const BALANCES_DB = LocalNano.db.use<BalanceDoc<JSPrimitiveNumberType>>('balances');
export const TRANSFER_ACTIVITY_DB = LocalNano.db.use<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activity');
export const MERKLE_CHALLENGES_DB = LocalNano.db.use<MerkleChallengeDoc<JSPrimitiveNumberType>>('merkle-challenges');
export const MSGS_DB = LocalNano.db.use<MsgDoc>('msgs');

//Local
export const ERRORS_DB = LocalNano.db.use<ErrorDoc>('errors');

//To put into clustered eventually


// (lastSeenActivity)
export const ANNOUNCEMENTS_DB = LocalNano.db.use<AnnouncementDoc<JSPrimitiveNumberType>>('announcements');
export const REVIEWS_DB = LocalNano.db.use<ReviewDoc<JSPrimitiveNumberType>>('reviews');
export const CLAIM_ALERTS_DB = LocalNano.db.use<ClaimAlertDoc<JSPrimitiveNumberType>>('claim-alerts');

export const REPORTS_DB = LocalNano.db.use<ReportDoc>('reports');
export const COMPLIANCE_DB = LocalNano.db.use<ComplianceDoc<JSPrimitiveNumberType>>('compliance');
export const ETH_TX_COUNT_DB = LocalNano.db.use<EthTxCountDoc>('eth-tx-count');

//Fine but need sticky sessions / no quick updates on diff nodes
//OFFCHAIN_ADDRESS_MAPPINGS_DB
export const PROFILES_DB = LocalNano.db.use<ProfileDoc<JSPrimitiveNumberType>>('profiles');

//Absolutely needs consistency
export const PASSWORDS_DB = LocalNano.db.use<PasswordDoc<JSPrimitiveNumberType>>('passwords');

//I think I am okay with these being clustered but not a perfect solution
export const API_KEYS_DB = LocalNano.db.use<ApiKeyDoc>('api-keys');
export const IPFS_TOTALS_DB = LocalNano.db.use<IPFSTotalsDoc<JSPrimitiveNumberType>>('ipfs-totals');

//Only for betanet
export const AIRDROP_DB = LocalNano.db.use<AirdropDoc<JSPrimitiveNumberType>>('airdrop');

//To think about
export const AUTH_CODES_DB = LocalNano.db.use<BlockinAuthSignatureDoc<JSPrimitiveNumberType>>('auth-codes');


export async function insertToDB(db: Nano.DocumentScope<BitBadgesDocumentBase<JSPrimitiveNumberType>>, doc: BitBadgesDocumentBase<NumberType> & Nano.MaybeDocument & { _deleted?: boolean }) {
  const res = await insertMany(db, [doc]);
  return res;
}

export async function insertMany(db: Nano.DocumentScope<BitBadgesDocumentBase<JSPrimitiveNumberType>>, docs: (BitBadgesDocumentBase<NumberType> & Nano.MaybeDocument & { _deleted?: boolean })[]) {
  const convertedDocs = await convertDocsToStoreInDb(db, docs);
  const res = await db.bulk({ docs: convertedDocs });
  return res;
}

export async function convertDocsToStoreInDb(db: Nano.DocumentScope<BitBadgesDocumentBase<JSPrimitiveNumberType>>, docs: (BitBadgesDocumentBase<NumberType> & Nano.MaybeDocument & { _deleted?: boolean })[]) {
  const convertedDocs: (BitBadgesDocumentBase<JSPrimitiveNumberType> & Nano.Document)[] = [];
  for (const doc of docs) {
    let convertedDoc = undefined;
    if (db.config.db === STATUS_DB.config.db) {
      convertedDoc = convertStatusDoc(doc as StatusDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === ACCOUNTS_DB.config.db) {
      convertedDoc = convertAccountDoc(doc as AccountDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === COLLECTIONS_DB.config.db) {
      convertedDoc = convertCollectionDoc(doc as CollectionDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === BALANCES_DB.config.db) {
      convertedDoc = convertBalanceDoc(doc as BalanceDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === MERKLE_CHALLENGES_DB.config.db) {
      convertedDoc = convertMerkleChallengeDoc(doc as MerkleChallengeDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === FETCHES_DB.config.db) {
      convertedDoc = convertFetchDoc(doc as FetchDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === QUEUE_DB.config.db) {
      convertedDoc = convertQueueDoc(doc as QueueDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === REFRESHES_DB.config.db) {
      convertedDoc = convertRefreshDoc(doc as RefreshDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === PASSWORDS_DB.config.db) {
      convertedDoc = convertPasswordDoc(doc as PasswordDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === PROFILES_DB.config.db) {
      convertedDoc = convertProfileDoc(doc as ProfileDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === TRANSFER_ACTIVITY_DB.config.db) {
      convertedDoc = convertTransferActivityDoc(doc as TransferActivityDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === ANNOUNCEMENTS_DB.config.db) {
      convertedDoc = convertAnnouncementDoc(doc as AnnouncementDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === REVIEWS_DB.config.db) {
      convertedDoc = convertReviewDoc(doc as ReviewDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === ERRORS_DB.config.db) {
      convertedDoc = doc as ErrorDoc;
    } else if (db.config.db === IPFS_TOTALS_DB.config.db) {
      convertedDoc = convertIPFSTotalsDoc(doc as IPFSTotalsDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === AIRDROP_DB.config.db) {
      convertedDoc = convertAirdropDoc(doc as AirdropDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === ADDRESS_MAPPINGS_DB.config.db) {
      convertedDoc = convertAddressMappingDoc(doc as AddressMappingDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === APPROVALS_TRACKER_DB.config.db) {
      convertedDoc = convertApprovalsTrackerDoc(doc as ApprovalsTrackerDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === API_KEYS_DB.config.db) {
      convertedDoc = doc as ApiKeyDoc;
    } else if (db.config.db === CLAIM_ALERTS_DB.config.db) {
      convertedDoc = convertClaimAlertDoc(doc as ClaimAlertDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === ETH_TX_COUNT_DB.config.db) {
      convertedDoc = doc as EthTxCountDoc;
    } else if (db.config.db === MSGS_DB.config.db) {
      convertedDoc = doc as MsgDoc;
    } else if (db.config.db === OFF_CHAIN_URLS_DB.config.db) {
      convertedDoc = doc as OffChainUrlDoc;
    } else if (db.config.db === REPORTS_DB.config.db) {
      convertedDoc = doc as ReportDoc;
    } else if (db.config.db === COMPLIANCE_DB.config.db) {
      convertedDoc = convertComplianceDoc(doc as ComplianceDoc<NumberType>, NumberifyIfPossible);
    } else if (db.config.db === AUTH_CODES_DB.config.db) {
      convertedDoc = convertBlockinAuthSignatureDoc(doc as BlockinAuthSignatureDoc<NumberType>, NumberifyIfPossible);
    }

    convertedDocs.push(convertedDoc as BitBadgesDocumentBase<JSPrimitiveNumberType> & Nano.Document);
  }

  return convertedDocs;
}

