import {
  AddressList,
  BitBadgesAddressList,
  UserIncomingApprovalWithDetails,
  UserOutgoingApprovalWithDetails,
  appendSelfInitiatedIncomingApproval,
  appendSelfInitiatedOutgoingApproval,
  type Metadata,
  type iAddressList,
  type iBitBadgesAddressList,
  type iUserBalanceStore,
  type iUserIncomingApproval,
  type iUserIncomingApprovalWithDetails,
  type iUserOutgoingApproval,
  type iUserOutgoingApprovalWithDetails,
  iApprovalCriteria,
  iIncomingApprovalCriteria,
  iMerkleChallenge,
  iOutgoingApprovalCriteria,
  iAddressListDoc
} from 'bitbadgesjs-sdk';
import { getFromDB, getManyFromDB } from '../db/db';
import { AddressListModel, ComplianceModel, FetchModel } from '../db/schemas';
import { executeListsActivityQueryForList } from './userQueries';

export function mustFind<T>(arr: T[], callbackFunc: (x: T) => boolean) {
  const found = arr.find(callbackFunc);
  if (!found) {
    throw new Error('Not found in mustFind');
  }
  return found;
}

export function mustFindAddressList(addressLists: iAddressList[], id: string) {
  return mustFind(addressLists, (x) => x.listId === id);
}

export function addBlankChallengeDetails(merkleChallenges: Array<iMerkleChallenge<bigint>>) {
  return merkleChallenges.map((y) => {
    return {
      ...y,
      challengeInfoDetails: {
        challengeDetails: {
          leaves: [],
          isHashed: false
        }
      }
    };
  });
}

export function addBlankChallengeDetailsToCriteria(
  approvalCriteria?: iApprovalCriteria<bigint> | iIncomingApprovalCriteria<bigint> | iOutgoingApprovalCriteria<bigint>
) {
  if (!approvalCriteria) return approvalCriteria;

  return {
    ...approvalCriteria,
    merkleChallenges: addBlankChallengeDetails(approvalCriteria.merkleChallenges ?? [])
  };
}

export async function mustGetAddressListsFromDB(
  listsToFetch: Array<{
    listId: string;
    viewsToFetch?: Array<{
      viewId: string;
      viewType: 'listActivity';
      bookmark: string;
    }>;
  }>,
  fetchMetadata: boolean,
  fetchActivity?: boolean,
  fetchedLists?: iAddressListDoc<bigint>[],
  allowPrivateLists?: boolean
) {
  const lists = await getAddressListsFromDB(listsToFetch, fetchMetadata, fetchActivity, fetchedLists);
  if (lists.length !== listsToFetch.length) {
    throw new Error('Not all lists found');
  }

  for (let i = 0; i < lists.length; i++) {
    if (lists[i].listId !== listsToFetch[i].listId) {
      throw new Error('List IDs do not match');
    }

    if (!allowPrivateLists && lists[i].private) {
      throw new Error('List is private which is not allowed here.');
    }
  }

  return lists;
}

export async function getAddressListsFromDB(
  listsToFetch: Array<{
    listId: string;
    viewsToFetch?: Array<{
      viewId: string;
      viewType: 'listActivity';
      bookmark: string;
    }>;
  }>,
  fetchMetadata: boolean,
  fetchActivity?: boolean,
  fetchedLists?: iAddressListDoc<bigint>[],
  allowPrivateLists?: boolean
) {
  fetchActivity = fetchActivity ?? fetchMetadata;
  const addressLists: Array<iBitBadgesAddressList<bigint>> = [];
  for (const listIdObj of listsToFetch) {
    try {
      const list = AddressList.getReservedAddressList(listIdObj.listId);
      if (list) {
        addressLists.push(
          new BitBadgesAddressList({
            ...list,
            _docId: '',
            updateHistory: [],
            createdBy: '',
            lastUpdated: 0n,
            createdBlock: 0n,
            listsActivity: [],
            claims: [],
            views: {}
          })
        );
        listsToFetch = listsToFetch.filter((x) => x.listId !== listIdObj.listId);
      }
    } catch (e) {
      // If it throws an error, it is a non-reserved ID
    }
  }

  if (listsToFetch.length > 0) {
    const listsToFetchFromDB = listsToFetch.filter((x) => !fetchedLists?.find((y) => y.listId === x.listId));

    const addressListDocsFromDB =
      listsToFetchFromDB.length > 0
        ? await getManyFromDB(
            AddressListModel,
            listsToFetchFromDB.map((x) => x.listId)
          )
        : [];

    const addressListDocs = [...(fetchedLists ?? []), ...addressListDocsFromDB];
    for (const doc of addressListDocs) {
      if (!doc) continue;
      addressLists.push(
        new BitBadgesAddressList({
          ...doc,
          claims: [],
          listsActivity: [],
          views: {}
        })
      );
    }

    if (fetchActivity) {
      const listActivityPromises = listsToFetch.map(async (listToFetch) => {
        const listActivity = fetchMetadata
          ? await executeListsActivityQueryForList(
              listToFetch.listId,
              false,
              listToFetch.viewsToFetch?.find((x) => x.viewType === 'listActivity')?.bookmark
            )
          : { docs: [], bookmark: '' };

        return { listToFetch, listActivity };
      });

      const listActivityResults = await Promise.all(listActivityPromises);

      listActivityResults.forEach(({ listToFetch, listActivity }) => {
        const list = addressLists.find((x) => x.listId === listToFetch.listId);
        if (list) {
          list.listsActivity = listActivity.docs;
          list.views.listActivity = {
            ids: listActivity.docs.map((x) => x._docId),
            type: 'List Activity',
            pagination: {
              bookmark: listActivity.bookmark ?? '',
              hasMore: listActivity.docs.length >= 25
            }
          };
        }
      });
    }
  }

  if (fetchMetadata) {
    const uris: string[] = [...new Set(addressLists.map((x) => x.uri).filter((x) => x))];
    const fetchesPromise = uris.length > 0 ? getManyFromDB(FetchModel, uris) : Promise.resolve([]);
    const complianceDocPromise = getFromDB(ComplianceModel, 'compliance');

    const [results, complianceDoc] = await Promise.all([fetchesPromise, complianceDocPromise]);

    if (uris.length > 0) {
      results.forEach((doc) => {
        if (doc?.content) {
          for (const list of addressLists) {
            if (list.uri === doc._docId) {
              list.metadata = doc.content as Metadata<bigint>;
            }
          }
        }
      });
    }

    for (const list of addressLists) {
      list.nsfw = complianceDoc?.addressLists.nsfw.find((y) => y.listId === list.listId);
      list.reported = complianceDoc?.addressLists.reported.find((y) => y.listId === list.listId);
    }
  }

  for (const list of addressLists) {
    if (!allowPrivateLists && list.private) {
      throw new Error('List is private which is not allowed here.');
    }
  }

  return addressLists;
}

export const appendSelfInitiatedIncomingApprovalToApprovals = <T extends bigint>(
  userBalance: iUserBalanceStore<T>,
  addressLists: iAddressList[],
  cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  const transfers: Array<iUserIncomingApprovalWithDetails<T>> | Array<iUserIncomingApproval<T>> = userBalance.incomingApprovals;
  const transfersWithDetails = transfers.map((transfer) => {
    return new UserIncomingApprovalWithDetails({
      ...transfer,
      fromList: mustFindAddressList(addressLists, transfer.fromListId),
      initiatedByList: mustFindAddressList(addressLists, transfer.initiatedByListId),
      approvalCriteria: addBlankChallengeDetailsToCriteria(transfer.approvalCriteria)
    });
  });

  return doNotAppendDefault === true || !userBalance.autoApproveSelfInitiatedIncomingTransfers
    ? transfersWithDetails
    : appendSelfInitiatedIncomingApproval(transfersWithDetails, cosmosAddress);
};

export const appendSelfInitiatedOutgoingApprovalToApprovals = <T extends bigint>(
  userBalance: iUserBalanceStore<T>,
  addressLists: iAddressList[],
  cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  const transfers: Array<iUserOutgoingApprovalWithDetails<T>> | Array<iUserOutgoingApproval<T>> = userBalance.outgoingApprovals;
  const transfersWithDetails = transfers.map((transfer) => {
    return new UserOutgoingApprovalWithDetails({
      ...transfer,
      toList: mustFindAddressList(addressLists, transfer.toListId),
      initiatedByList: mustFindAddressList(addressLists, transfer.initiatedByListId),
      approvalCriteria: addBlankChallengeDetailsToCriteria(transfer.approvalCriteria)
    });
  });

  return doNotAppendDefault === true || !userBalance.autoApproveSelfInitiatedOutgoingTransfers
    ? transfersWithDetails
    : appendSelfInitiatedOutgoingApproval(transfersWithDetails, cosmosAddress);
};
