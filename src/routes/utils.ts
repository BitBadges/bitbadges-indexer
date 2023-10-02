import { AddressMapping, BigIntify, JSPrimitiveNumberType, NumberType, UserApprovedIncomingTransfer, UserApprovedOutgoingTransfer, convertManagerTimeline } from "bitbadgesjs-proto";
import { AddressMappingWithMetadata, Metadata, Stringify, UserApprovedIncomingTransferWithDetails, UserApprovedOutgoingTransferWithDetails, appendDefaultForIncoming, appendDefaultForOutgoing, convertMetadata, convertUserApprovedIncomingTransferWithDetails, convertUserApprovedOutgoingTransferWithDetails, getCurrentValueForTimeline, getFirstMatchForUserIncomingApprovedTransfers, getFirstMatchForUserOutgoingApprovedTransfers, getReservedAddressMapping } from "bitbadgesjs-utils";
import { ADDRESS_MAPPINGS_DB, COLLECTIONS_DB, FETCHES_DB } from "../db/db";
import { catch404, getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

export async function getAddressMappingsFromDB(mappingIds: {
  mappingId: string;
  collectionId?: NumberType;
}[], fetchMetadata: boolean, manager?: string) {
  let addressMappingIdsToFetch = [...new Set(mappingIds)];
  let addressMappings: AddressMappingWithMetadata<bigint>[] = [];
  for (const mappingIdObj of addressMappingIdsToFetch) {
    if (mappingIdObj.mappingId === 'Manager' && !manager) {
      if (!mappingIdObj.collectionId) {
        throw new Error('Must specify collectionId or manager address in request, if you want to fetch the Manager mapping.');
      }

      const collectionRes = await COLLECTIONS_DB.get(mappingIdObj.collectionId.toString());
      manager = getCurrentValueForTimeline(collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify)))?.manager ?? '';
    }

    const mapping = getReservedAddressMapping(mappingIdObj.mappingId, manager ?? '');
    if (mapping) {
      addressMappings.push({
        ...mapping,
        _id: '',
        lastUpdated: BigInt(Date.now()),
        createdBy: '',
        createdBlock: BigInt(0),
        createdTimestamp: BigInt(0),
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


export const appendDefaultForIncomingUserApprovedTransfers = (
  transfers: UserApprovedIncomingTransfer<NumberType>[] | UserApprovedIncomingTransferWithDetails<NumberType>[],
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      fromMapping: addressMappings.find((x) => x.mappingId === transfer.fromMappingId) as AddressMapping,
      initiatedByMapping: addressMappings.find((x) => x.mappingId === transfer.initiatedByMappingId) as AddressMapping,
    };
  }).map(x => convertUserApprovedIncomingTransferWithDetails(x, BigIntify))

  return getFirstMatchForUserIncomingApprovedTransfers(
    doNotAppendDefault ? transfersWithDetails :
      appendDefaultForIncoming(transfersWithDetails, cosmosAddress),
    cosmosAddress,
    !doNotAppendDefault
  ).map(x => convertUserApprovedIncomingTransferWithDetails(x, Stringify))
}

export const appendDefaultForOutgoingUserApprovedTransfers = (
  transfers: UserApprovedOutgoingTransfer<NumberType>[] | UserApprovedOutgoingTransferWithDetails<NumberType>[],
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let transfersWithDetails = transfers.map((transfer) => {
    return {
      ...transfer,
      toMapping: addressMappings.find((x) => x.mappingId === transfer.toMappingId) as AddressMapping,
      initiatedByMapping: addressMappings.find((x) => x.mappingId === transfer.initiatedByMappingId) as AddressMapping,
    };
  }

  ).map(x => convertUserApprovedOutgoingTransferWithDetails(x, BigIntify))

  return getFirstMatchForUserOutgoingApprovedTransfers(
    doNotAppendDefault ? transfersWithDetails :
      appendDefaultForOutgoing(transfersWithDetails, cosmosAddress),
    cosmosAddress,
    !doNotAppendDefault
  ).map(x => convertUserApprovedOutgoingTransferWithDetails(x, Stringify))
}