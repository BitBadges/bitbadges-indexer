import { AddressMapping, BigIntify, JSPrimitiveNumberType, NumberType, Stringify, UserBalance, UserIncomingApproval, UserOutgoingApproval } from "bitbadgesjs-proto";
import { AddressMappingWithMetadata, Metadata, UserIncomingApprovalWithDetails, UserOutgoingApprovalWithDetails, appendDefaultForIncoming, appendDefaultForOutgoing, convertMetadata, convertUserIncomingApprovalWithDetails, convertUserOutgoingApprovalWithDetails, getReservedAddressMapping } from "bitbadgesjs-utils";
import { ADDRESS_MAPPINGS_DB, FETCHES_DB } from "../db/db";
import { catch404, getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

export async function getAddressMappingsFromDB(mappingIds: {
  mappingId: string;
  collectionId?: NumberType;
}[], fetchMetadata: boolean) {
  let addressMappingIdsToFetch = [...new Set(mappingIds)];
  let addressMappings: AddressMappingWithMetadata<bigint>[] = [];
  for (const mappingIdObj of addressMappingIdsToFetch) {
    const mapping = getReservedAddressMapping(mappingIdObj.mappingId);
    if (mapping) {
      addressMappings.push({
        ...mapping,
        _id: '',
        updateHistory: [],
        createdBy: '',
        lastUpdated: 0n,
        createdBlock: 0n,
      });
      addressMappingIdsToFetch = addressMappingIdsToFetch.filter((x) => x.mappingId !== mappingIdObj.mappingId);
    }
  }

  addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

  if (addressMappingIdsToFetch.length > 0) {
    const fetchedAddressMappings = await ADDRESS_MAPPINGS_DB.fetch({ keys: addressMappingIdsToFetch.map(x => x.mappingId) }, { include_docs: true });
    const addressMappingDocs = getDocsFromNanoFetchRes(fetchedAddressMappings);
    addressMappings.push(...addressMappingDocs.map((doc) => removeCouchDBDetails(doc)));
  }

  if (fetchMetadata) {
    let uris: string[] = [...new Set(addressMappings.map(x => x.uri))];

    if (uris.length > 0) {
      const fetchPromises = uris.map(async (uri) => {
        if (!uri) {
          return { uri, doc: undefined };
        }
        const doc = await FETCHES_DB.get(uri).catch(catch404);
        return { uri, doc };
      });

      const results = await Promise.all(fetchPromises);

      results.forEach(({ uri, doc }) => {
        if (doc && doc.content) {
          addressMappings = addressMappings.map(x => (x.uri === uri) ? { ...x, metadata: convertMetadata(doc.content as Metadata<JSPrimitiveNumberType>, BigIntify) } : x);
        }
      });
    }
  }


  return addressMappings;
}


export const appendDefaultForIncomingUserApprovals = (
  userBalance: UserBalance<NumberType>,
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfers: UserIncomingApprovalWithDetails<NumberType>[] | UserIncomingApproval<NumberType>[] = userBalance.incomingApprovals;
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      fromMapping: addressMappings.find((x) => x.mappingId === transfer.fromMappingId) as AddressMapping,
      initiatedByMapping: addressMappings.find((x) => x.mappingId === transfer.initiatedByMappingId) as AddressMapping,
    };
  }).map(x => convertUserIncomingApprovalWithDetails(x, BigIntify))

  return (doNotAppendDefault || !userBalance.autoApproveSelfInitiatedIncomingTransfers
    ? transfersWithDetails
    : appendDefaultForIncoming(transfersWithDetails, cosmosAddress,)).map(x => convertUserIncomingApprovalWithDetails(x, Stringify)
    )
}

export const appendDefaultForOutgoingUserApprovals = (
  userBalance: UserBalance<NumberType>,
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfers: UserOutgoingApprovalWithDetails<NumberType>[] | UserOutgoingApproval<NumberType>[] = userBalance.outgoingApprovals;
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      toMapping: addressMappings.find((x) => x.mappingId === transfer.toMappingId) as AddressMapping,
      initiatedByMapping: addressMappings.find((x) => x.mappingId === transfer.initiatedByMappingId) as AddressMapping,
    };
  }

  ).map(x => convertUserOutgoingApprovalWithDetails(x, BigIntify))

  return (doNotAppendDefault || !userBalance.autoApproveSelfInitiatedOutgoingTransfers
    ? transfersWithDetails : appendDefaultForOutgoing(transfersWithDetails, cosmosAddress)).map(x => convertUserOutgoingApprovalWithDetails(x, Stringify))
}