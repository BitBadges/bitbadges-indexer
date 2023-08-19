import { JSPrimitiveNumberType, NumberType } from 'bitbadgesjs-proto';
import { convertAddressMappingDoc, AccountDoc, AccountInfoBase, ActivityInfoBase, AddressMappingDoc, AirdropDoc, AirdropInfoBase, AnnouncementDoc, AnnouncementInfoBase, ApprovalsTrackerDoc, BalanceDoc, BalanceInfoBase, CollectionDoc, CollectionInfoBase, ErrorDoc, FetchDoc, FetchInfoBase, IPFSTotalsDoc, IPFSTotalsInfoBase, MerkleChallengeDoc, MerkleChallengeInfoBase, NumberifyIfPossible, PasswordDoc, PasswordInfoBase, ProfileDoc, ProfileInfoBase, QueueDoc, QueueInfoBase, RefreshDoc, RefreshInfoBase, ReviewDoc, ReviewInfoBase, StatusDoc, StatusInfoBase, TransferActivityDoc, TransferActivityInfoBase, convertAccountDoc, convertAirdropDoc, convertAnnouncementDoc, convertApprovalsTrackerDoc, convertBalanceDoc, convertCollectionDoc, convertFetchDoc, convertIPFSTotalsDoc, convertMerkleChallengeDoc, convertPasswordDoc, convertProfileDoc, convertQueueDoc, convertRefreshDoc, convertReviewDoc, convertStatusDoc, convertTransferActivityDoc, ClaimAlertDoc, convertClaimAlertDoc } from "bitbadgesjs-utils";
import { config } from "dotenv";
import Nano from "nano";

config();

const nano = Nano(`${process.env.DB_URL}`);

interface ApiKeyDoc {
  numRequests: number;
  lastRequest: number;
}

export type BitBadgesDocumentBase<T extends NumberType> = TransferActivityInfoBase<T> | ReviewInfoBase<T> | AnnouncementInfoBase<T> | ActivityInfoBase<T> | ProfileInfoBase<T> | AccountInfoBase<T> | CollectionInfoBase<T> | StatusInfoBase<T> | PasswordInfoBase<T> | BalanceInfoBase<T> | MerkleChallengeInfoBase<T> | FetchInfoBase<T> | QueueInfoBase<T> | RefreshInfoBase<T> | IPFSTotalsInfoBase<T> | ErrorDoc | AirdropInfoBase<T> | ApprovalsTrackerDoc<T> | AddressMappingDoc<T> | ApiKeyDoc | ClaimAlertDoc<T>

export const API_KEYS_DB = nano.db.use<ApiKeyDoc>('api-keys');
export const TRANSFER_ACTIVITY_DB = nano.db.use<TransferActivityDoc<JSPrimitiveNumberType>>('transfer-activity');
export const PROFILES_DB = nano.db.use<ProfileDoc<JSPrimitiveNumberType>>('profiles');
export const ACCOUNTS_DB = nano.db.use<AccountDoc<JSPrimitiveNumberType>>('accounts');
export const COLLECTIONS_DB = nano.db.use<CollectionDoc<JSPrimitiveNumberType>>('collections');
export const STATUS_DB = nano.db.use<StatusDoc<JSPrimitiveNumberType>>('status');
export const ERRORS_DB = nano.db.use<ErrorDoc>('errors');
export const PASSWORDS_DB = nano.db.use<PasswordDoc<JSPrimitiveNumberType>>('passwords');
export const AIRDROP_DB = nano.db.use<AirdropDoc<JSPrimitiveNumberType>>('airdrop');
export const BALANCES_DB = nano.db.use<BalanceDoc<JSPrimitiveNumberType>>('balances');
export const MERKLE_CHALLENGES_DB = nano.db.use<MerkleChallengeDoc<JSPrimitiveNumberType>>('merkle-challenges');
export const FETCHES_DB = nano.db.use<FetchDoc<JSPrimitiveNumberType>>('fetches');
export const QUEUE_DB = nano.db.use<QueueDoc<JSPrimitiveNumberType>>('queue');
export const IPFS_TOTALS_DB = nano.db.use<IPFSTotalsDoc<JSPrimitiveNumberType>>('ipfs-totals');
export const REFRESHES_DB = nano.db.use<RefreshDoc<JSPrimitiveNumberType>>('refreshes');
export const ANNOUNCEMENTS_DB = nano.db.use<AnnouncementDoc<JSPrimitiveNumberType>>('announcements');
export const REVIEWS_DB = nano.db.use<ReviewDoc<JSPrimitiveNumberType>>('reviews');
export const ADDRESS_MAPPINGS_DB = nano.db.use<AddressMappingDoc<JSPrimitiveNumberType>>('address-mappings');
export const APPROVALS_TRACKER_DB = nano.db.use<ApprovalsTrackerDoc<JSPrimitiveNumberType>>('approvals-trackers');
export const CLAIM_ALERTS_DB = nano.db.use<ClaimAlertDoc<JSPrimitiveNumberType>>('claim-alerts');

export async function insertToDB(db: Nano.DocumentScope<BitBadgesDocumentBase<JSPrimitiveNumberType>>, doc: BitBadgesDocumentBase<NumberType> & Nano.MaybeDocument & { _deleted?: boolean }) {

  await insertMany(db, [doc]);
}

export async function insertMany(db: Nano.DocumentScope<BitBadgesDocumentBase<JSPrimitiveNumberType>>, docs: (BitBadgesDocumentBase<NumberType> & Nano.MaybeDocument & { _deleted?: boolean })[]) {
  const convertedDocs = await convertDocsToStoreInDb(db, docs);
  await db.bulk({ docs: convertedDocs });
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
    }

    convertedDocs.push(convertedDoc as BitBadgesDocumentBase<JSPrimitiveNumberType> & Nano.Document);
  }

  return convertedDocs;
}

