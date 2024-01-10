import { AddressList, BigIntify, JSPrimitiveNumberType, NumberType, Stringify, UserBalanceStore, UserIncomingApproval, UserOutgoingApproval } from "bitbadgesjs-proto";
import { AddressListWithMetadata, Metadata, UserIncomingApprovalWithDetails, UserOutgoingApprovalWithDetails, appendSelfInitiatedIncomingApproval, appendSelfInitiatedOutgoingApproval, convertAddressListWithMetadata, convertMetadata, convertUserIncomingApprovalWithDetails, convertUserOutgoingApprovalWithDetails, getReservedAddressList } from "bitbadgesjs-utils";
import { AddressListModel, FetchModel, getFromDB, mustGetManyFromDB } from "../db/db";
import { complianceDoc } from "../poll";

export async function getAddressListsFromDB(listIds: {
  listId: string;
  collectionId?: NumberType;
}[], fetchMetadata: boolean) {
  let addressListIdsToFetch = [...new Set(listIds)];
  let addressLists: AddressListWithMetadata<bigint>[] = [];
  for (const listIdObj of addressListIdsToFetch) {
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
        });
        addressListIdsToFetch = addressListIdsToFetch.filter((x) => x.listId !== listIdObj.listId);
      }
    } catch (e) {
      //If it throws an error, it is a non-reserved ID
    }
  }

  addressListIdsToFetch = [...new Set(addressListIdsToFetch)];

  if (addressListIdsToFetch.length > 0) {
    const addressListDocs = await mustGetManyFromDB(AddressListModel, addressListIdsToFetch.map(x => x.listId));
    addressLists.push(...addressListDocs.map((doc) => convertAddressListWithMetadata(doc, BigIntify)));
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