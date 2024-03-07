import {
  AddressList,
  BitBadgesAddressList,
  UserIncomingApprovalWithDetails,
  UserOutgoingApprovalWithDetails,
  appendSelfInitiatedIncomingApproval,
  appendSelfInitiatedOutgoingApproval,
  type iAddressList,
  type iBitBadgesAddressList,
  type iUserBalanceStore,
  type iUserIncomingApproval,
  type iUserIncomingApprovalWithDetails,
  type iUserOutgoingApproval,
  type iUserOutgoingApprovalWithDetails,
  type Metadata
} from 'bitbadgesjs-sdk';
import { AddressListModel, FetchModel } from '../db/schemas';
import { getFromDB, mustGetManyFromDB } from '../db/db';
import { complianceDoc } from '../poll';
import { mustFindAddressList } from './balances';
import { executeListsActivityQueryForList } from './userQueries';

export async function getAddressListsFromDB(
  listsToFetch: Array<{
    listId: string;
    viewsToFetch?: Array<{
      viewId: string;
      viewType: 'listActivity';
      bookmark: string;
    }>;
  }>,
  fetchMetadata: boolean
) {
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
            editClaims: [],
            views: {}
          })
        );
        listsToFetch = listsToFetch.filter((x) => x.listId !== listIdObj.listId);
      }
    } catch (e) {
      // If it throws an error, it is a non-reserved ID
    }
  }

  // addressListIdsToFetch = [...new Set(addressListIdsToFetch)];

  if (listsToFetch.length > 0) {
    const addressListDocs = await mustGetManyFromDB(
      AddressListModel,
      listsToFetch.map((x) => x.listId)
    );
    for (const listToFetch of listsToFetch) {
      const listActivity = fetchMetadata
        ? await executeListsActivityQueryForList(
            listToFetch.listId,
            false,
            listToFetch.viewsToFetch?.find((x) => x.viewType === 'listActivity')?.bookmark
          )
        : { docs: [], bookmark: '' };

      const doc = addressListDocs.find((x) => x.listId === listToFetch.listId);
      if (doc) {
        addressLists.push(
          new BitBadgesAddressList<bigint>({
            ...doc,
            editClaims: [],
            listsActivity: listActivity.docs,
            views: fetchMetadata
              ? {
                  listActivity: {
                    ids: listActivity.docs.map((x) => x._docId),
                    type: 'List Activity',
                    pagination: {
                      bookmark: listActivity.bookmark ?? '',
                      hasMore: listActivity.docs.length >= 25
                    }
                  }
                }
              : {}
          })
        );
      }
    }
  }

  if (fetchMetadata) {
    const uris: string[] = [...new Set(addressLists.map((x) => x.uri))];

    if (uris.length > 0) {
      const fetchPromises = uris.map(async (uri) => {
        if (!uri) {
          return { uri, doc: undefined };
        }
        const doc = await getFromDB(FetchModel, uri);
        return { uri, doc };
      });

      const results = await Promise.all(fetchPromises);

      results.forEach(({ uri, doc }) => {
        if (doc?.content) {
          for (const list of addressLists) {
            if (list.uri === uri) {
              list.metadata = doc.content as Metadata<bigint>;
            }
          }
        }
      });
    }
  }

  for (const list of addressLists) {
    list.nsfw = complianceDoc?.addressLists.nsfw.find((y) => y.listId === list.listId);
    list.reported = complianceDoc?.addressLists.reported.find((y) => y.listId === list.listId);
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
      initiatedByList: mustFindAddressList(addressLists, transfer.initiatedByListId)
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
      initiatedByList: mustFindAddressList(addressLists, transfer.initiatedByListId)
    });
  });

  return doNotAppendDefault === true || !userBalance.autoApproveSelfInitiatedOutgoingTransfers
    ? transfersWithDetails
    : appendSelfInitiatedOutgoingApproval(transfersWithDetails, cosmosAddress);
};
