import { AddressMapping, BigIntify, JSPrimitiveNumberType, NumberType, Stringify, UserApprovedIncomingTransferTimeline, UserApprovedOutgoingTransferTimeline, convertManagerTimeline, convertUintRange } from "bitbadgesjs-proto";
import { AddressMappingWithMetadata, Metadata, UserApprovedIncomingTransferTimelineWithDetails, UserApprovedOutgoingTransferTimelineWithDetails, appendDefaultForIncoming, appendDefaultForOutgoing, convertMetadata, convertUserApprovedIncomingTransferTimelineWithDetails, convertUserApprovedOutgoingTransferTimelineWithDetails, getCurrentValueForTimeline, getFirstMatchForUserIncomingApprovedTransfers, getFirstMatchForUserOutgoingApprovedTransfers, getFullDefaultUserApprovedIncomingTransfersTimeline, getFullDefaultUserApprovedOutgoingTransfersTimeline, getReservedAddressMapping } from "bitbadgesjs-utils";
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
  timeline: UserApprovedIncomingTransferTimeline<NumberType>[] | UserApprovedIncomingTransferTimelineWithDetails<NumberType>[],
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let timelineWithDetails = timeline.map((timeline) => {
    return {
      ...timeline,
      approvedIncomingTransfers:
        timeline.approvedIncomingTransfers.map((incoming) => {
          const fromMapping = addressMappings.find((x) => x.mappingId === incoming.fromMappingId);
          const initiatedByMapping = addressMappings.find((x) => x.mappingId === incoming.initiatedByMappingId);

          return {
            ...incoming,
            fromMapping: fromMapping as AddressMapping,
            initiatedByMapping: initiatedByMapping as AddressMapping,
          };
        }),
    };
  }).map(x => convertUserApprovedIncomingTransferTimelineWithDetails(x, BigIntify))

  if (!doNotAppendDefault) {
    timelineWithDetails = getFullDefaultUserApprovedIncomingTransfersTimeline(timelineWithDetails);
  }

  return timelineWithDetails.map((timeline) => {

    return {
      timelineTimes: timeline.timelineTimes.map(x => convertUintRange(x, BigIntify)),
      approvedIncomingTransfers: getFirstMatchForUserIncomingApprovedTransfers(
        doNotAppendDefault ? timeline.approvedIncomingTransfers :
          appendDefaultForIncoming(timeline.approvedIncomingTransfers, cosmosAddress),
        cosmosAddress,
        true
      )
    }
  }).map(x => convertUserApprovedIncomingTransferTimelineWithDetails(x, Stringify))
}

export const appendDefaultForOutgoingUserApprovedTransfers = (
  timeline: UserApprovedOutgoingTransferTimeline<NumberType>[] | UserApprovedOutgoingTransferTimelineWithDetails<NumberType>[],
  addressMappings: AddressMapping[], cosmosAddress: string,
  doNotAppendDefault?: boolean
) => {
  let timelineWithDetails = timeline.map((timeline) => {
    return {
      ...timeline,
      approvedOutgoingTransfers: timeline.approvedOutgoingTransfers.map((outgoing) => {
        const toMapping = addressMappings.find((x) => x.mappingId === outgoing.toMappingId);
        const initiatedByMapping = addressMappings.find((x) => x.mappingId === outgoing.initiatedByMappingId);

        return {
          ...outgoing,
          toMapping: toMapping as AddressMapping,
          initiatedByMapping: initiatedByMapping as AddressMapping,
        };
      }),
    };
  }).map(x => convertUserApprovedOutgoingTransferTimelineWithDetails(x, BigIntify))

  if (!doNotAppendDefault) {
    timelineWithDetails = getFullDefaultUserApprovedOutgoingTransfersTimeline(timelineWithDetails);
  }

  return timelineWithDetails.map((timeline) => {
    return {
      timelineTimes: timeline.timelineTimes.map(x => convertUintRange(x, BigIntify)),
      approvedOutgoingTransfers: getFirstMatchForUserOutgoingApprovedTransfers(
        doNotAppendDefault ? timeline.approvedOutgoingTransfers :
          appendDefaultForOutgoing(timeline.approvedOutgoingTransfers, cosmosAddress),
        cosmosAddress,
        true
      )
    }
  }).map(x => convertUserApprovedOutgoingTransferTimelineWithDetails(x, Stringify))
};