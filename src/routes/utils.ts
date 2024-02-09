import { AddressList, BigIntify, JSPrimitiveNumberType, NumberType, Stringify, UserBalanceStore, UserIncomingApproval, UserOutgoingApproval } from "bitbadgesjs-sdk";
import { BitBadgesAddressList, Metadata, UserIncomingApprovalWithDetails, UserOutgoingApprovalWithDetails, appendSelfInitiatedIncomingApproval, appendSelfInitiatedOutgoingApproval, convertBitBadgesAddressList, convertMetadata, convertUserIncomingApprovalWithDetails, convertUserOutgoingApprovalWithDetails, getReservedAddressList } from "bitbadgesjs-sdk";
import { AddressListModel, FetchModel, getFromDB, mustGetManyFromDB } from "../db/db";
import { complianceDoc } from "../poll";
import { executeListsActivityQueryForList } from "./userQueries";

export async function getAddressListsFromDB(listsToFetch: {
  listId: string;
  viewsToFetch?: {
    viewId: string;
    viewType: 'listActivity';
    bookmark: string;
  }[];
}[], fetchMetadata: boolean) {
  let addressLists: BitBadgesAddressList<bigint>[] = [];
  for (const listIdObj of listsToFetch) {
    try {
      const list = getReservedAddressList(listIdObj.listId);
      if (list) {
        addressLists.push({
          ...list,
          _docId: '',
          updateHistory: [],
          createdBy: '',
          lastUpdated: 0n,
          createdBlock: 0n,
          listsActivity: [],
          views: {},
        });
        listsToFetch = listsToFetch.filter((x) => x.listId !== listIdObj.listId);
      }
    } catch (e) {
      //If it throws an error, it is a non-reserved ID
    }
  }

  // addressListIdsToFetch = [...new Set(addressListIdsToFetch)];

  if (listsToFetch.length > 0) {
    const addressListDocs = await mustGetManyFromDB(AddressListModel, listsToFetch.map(x => x.listId));
    for (const listToFetch of listsToFetch) {
      const listActivity = fetchMetadata ? await executeListsActivityQueryForList(
        listToFetch.listId,
        false,
        listToFetch.viewsToFetch?.find((x) => x.viewType === 'listActivity')?.bookmark,
      ) : { docs: [], bookmark: '' };

      const doc = addressListDocs.find((x) => x.listId === listToFetch.listId);
      if (doc) {
        addressLists.push(convertBitBadgesAddressList({
          ...doc,
          listsActivity: listActivity.docs,
          views: fetchMetadata ? {
            listActivity: {
              ids: listActivity.docs.map(x => x._docId),
              type: 'List Activity',
              pagination: {
                bookmark: listActivity.bookmark ?? '',
                hasMore: listActivity.docs.length >= 25,
              }
            }
          } : {}
        }, BigIntify));
      }
    }
  }

  if (fetchMetadata) {
    let uris: string[] = [...new Set(addressLists.map(x => x.uri))];

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
        if (doc && doc.content) {
          addressLists = addressLists.map(x => (x.uri === uri) ? { ...x, metadata: convertMetadata(doc.content as Metadata<JSPrimitiveNumberType>, BigIntify) } : x);
        }
      });
    }
  }


  return addressLists.map(x => {
    const isNSFW = complianceDoc?.addressLists.nsfw.find((y) => y.listId === x.listId);
    const isReported = complianceDoc?.addressLists.reported.find((y) => y.listId === x.listId);
    return {
      ...x,
      nsfw: isNSFW,
      reported: isReported,
    }
  })
}


export const appendSelfInitiatedIncomingApprovalToApprovals = (
  userBalance: UserBalanceStore<NumberType>,
  addressLists: AddressList[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfers: UserIncomingApprovalWithDetails<NumberType>[] | UserIncomingApproval<NumberType>[] = userBalance.incomingApprovals;
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      fromList: addressLists.find((x) => x.listId === transfer.fromListId) as AddressList,
      initiatedByList: addressLists.find((x) => x.listId === transfer.initiatedByListId) as AddressList,
    };
  }).map(x => convertUserIncomingApprovalWithDetails(x, BigIntify))

  return (doNotAppendDefault || !userBalance.autoApproveSelfInitiatedIncomingTransfers
    ? transfersWithDetails
    : appendSelfInitiatedIncomingApproval(transfersWithDetails, cosmosAddress,)).map(x => convertUserIncomingApprovalWithDetails(x, Stringify)
    )
}

export const appendSelfInitiatedOutgoingApprovalToApprovals = (
  userBalance: UserBalanceStore<NumberType>,
  addressLists: AddressList[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfers: UserOutgoingApprovalWithDetails<NumberType>[] | UserOutgoingApproval<NumberType>[] = userBalance.outgoingApprovals;
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      toList: addressLists.find((x) => x.listId === transfer.toListId) as AddressList,
      initiatedByList: addressLists.find((x) => x.listId === transfer.initiatedByListId) as AddressList,
    };
  }

  ).map(x => convertUserOutgoingApprovalWithDetails(x, BigIntify))

  return (doNotAppendDefault || !userBalance.autoApproveSelfInitiatedOutgoingTransfers
    ? transfersWithDetails : appendSelfInitiatedOutgoingApproval(transfersWithDetails, cosmosAddress)).map(x => convertUserOutgoingApprovalWithDetails(x, Stringify))
}