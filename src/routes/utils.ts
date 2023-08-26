import { AddressMapping, BigIntify, NumberType, Stringify, UserApprovedIncomingTransferTimeline, UserApprovedOutgoingTransferTimeline, convertManagerTimeline, convertUintRange } from "bitbadgesjs-proto";
import { UserApprovedIncomingTransferTimelineWithDetails, UserApprovedOutgoingTransferTimelineWithDetails, appendDefaultForIncoming, appendDefaultForOutgoing, convertUserApprovedIncomingTransferTimelineWithDetails, convertUserApprovedOutgoingTransferTimelineWithDetails, getCurrentValueIdxForTimeline, getFirstMatchForUserIncomingApprovedTransfers, getFirstMatchForUserOutgoingApprovedTransfers, getFullDefaultUserApprovedIncomingTransfersTimeline, getFullDefaultUserApprovedOutgoingTransfersTimeline, getReservedAddressMapping } from "bitbadgesjs-utils";
import { ADDRESS_MAPPINGS_DB, COLLECTIONS_DB } from "../db/db";
import { getDocsFromNanoFetchRes, removeCouchDBDetails } from "../utils/couchdb-utils";

export async function getAddressMappingsFromDB(mappingIds: {
  mappingId: string;
  collectionId: NumberType;
}[], manager?: string) {
  let addressMappingIdsToFetch = [...new Set(mappingIds)];
  const addressMappings: AddressMapping[] = [];
  for (const mappingIdObj of addressMappingIdsToFetch) {
    let managerVal = manager ?? '';


    if (mappingIdObj.mappingId === 'Manager' && !managerVal) {
      const collectionRes = await COLLECTIONS_DB.get(mappingIdObj.collectionId.toString());
      const managerIdx = getCurrentValueIdxForTimeline(collectionRes.managerTimeline.map(x => convertManagerTimeline(x, BigIntify)));

      if (managerIdx !== -1n) {
        manager = collectionRes.managerTimeline[Number(managerIdx)].manager;
      }
    }

    const mapping = getReservedAddressMapping(mappingIdObj.mappingId, managerVal);
    if (mapping) {
      addressMappings.push(mapping);
      addressMappingIdsToFetch = addressMappingIdsToFetch.filter((x) => x.mappingId !== mappingIdObj.mappingId);
    }
  }

  addressMappingIdsToFetch = [...new Set(addressMappingIdsToFetch)];

  if (addressMappingIdsToFetch.length > 0) {
    const fetchedAddressMappings = await ADDRESS_MAPPINGS_DB.fetch({ keys: addressMappingIdsToFetch.map(x => x.mappingId) }, { include_docs: true });
    const addressMappingDocs = getDocsFromNanoFetchRes(fetchedAddressMappings);
    addressMappings.push(...addressMappingDocs.map((doc) => removeCouchDBDetails(doc)));
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