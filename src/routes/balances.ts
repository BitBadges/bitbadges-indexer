import axios from "axios";
import { AddressMapping, Balance, BigIntify, JSPrimitiveNumberType, UserPermissions, convertBalance, convertOffChainBalancesMetadataTimeline } from "bitbadgesjs-proto";
import { BalanceDocWithDetails, GetBadgeBalanceByAddressRouteResponse, NumberType, Stringify, UserPermissionsWithDetails, convertBalanceDoc, convertCollectionDoc, convertToCosmosAddress, convertUserPermissionsWithDetails, getCurrentValueForTimeline } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { getFromIpfs } from "../ipfs/ipfs";
import { BalanceModel, CollectionModel, getFromDB, mustGetFromDB } from "../db/db";
import { appendDefaultForIncomingUserApprovals, appendDefaultForOutgoingUserApprovals, getAddressMappingsFromDB } from "./utils";
import { getBalancesForEthFirstTx } from "../indexer";

export const applyAddressMappingsToUserPermissions = (userPermissions: UserPermissions<JSPrimitiveNumberType>, addressMappings: AddressMapping[]): UserPermissionsWithDetails<JSPrimitiveNumberType> => {
  return {
    ...userPermissions,
    canUpdateIncomingApprovals: userPermissions.canUpdateIncomingApprovals.map((x) => {
      return {
        ...x,
        fromMapping: addressMappings.find((y) => y.mappingId === x.fromMappingId) as AddressMapping,
        initiatedByMapping: addressMappings.find((y) => y.mappingId === x.initiatedByMappingId) as AddressMapping,
      }
    }),
    canUpdateOutgoingApprovals: userPermissions.canUpdateOutgoingApprovals.map((x) => {
      return {
        ...x,
        toMapping: addressMappings.find((y) => y.mappingId === x.toMappingId) as AddressMapping,
        initiatedByMapping: addressMappings.find((y) => y.mappingId === x.initiatedByMappingId) as AddressMapping,
      }
    })
  }
}

export const getBadgeBalanceByAddress = async (req: Request, res: Response<GetBadgeBalanceByAddressRouteResponse<NumberType>>) => {
  try {

    const cosmosAddress = `${convertToCosmosAddress(req.params.cosmosAddress).toString()}`;
    const docId = `${req.params.collectionId}:${cosmosAddress}`
    const _collection = await mustGetFromDB(CollectionModel, req.params.collectionId);
    const collection = convertCollectionDoc(_collection, Stringify);

    if (collection.balancesType === "Off-Chain - Non-Indexed") {
      //we need to fetch from source directly
      const uri = getCurrentValueForTimeline(collection.offChainBalancesMetadataTimeline.map(x => convertOffChainBalancesMetadataTimeline(x, BigIntify)))?.offChainBalancesMetadata.uri
      const uriToFetch = uri?.replace("{address}", convertToCosmosAddress(cosmosAddress));

      let balancesRes = undefined;
      //If we are here, we need to fetch from the source
      if (uriToFetch?.startsWith('ipfs://')) {
        const _res: any = await getFromIpfs(uriToFetch.replace('ipfs://', ''));
        balancesRes = JSON.parse(_res.file).balances;
      } else if (uriToFetch) {
        console.log(uriToFetch);
        if (uriToFetch === "https://api.bitbadges.io/api/v0/ethFirstTx/" + cosmosAddress) {
          //Hardcoded to fetch locally instead of from source GET
          balancesRes = await getBalancesForEthFirstTx(cosmosAddress);
        } else {
          const _res = await axios.get(uriToFetch).then((res) => res.data);
          balancesRes = _res.balances
        }
      }

      //Check if valid array
      const balances: Balance<NumberType>[] = balancesRes && Array.isArray(balancesRes) && balancesRes.every((balance: any) => typeof balance === "object")
        ? balancesRes.map((balance: any) => ({
          amount: balance.amount ? BigInt(balance.amount).toString() : "0",
          badgeIds: Array.isArray(balance.badgeIds) && balance.badgeIds.every((badgeId: any) => typeof badgeId === "object")
            ? balance.badgeIds.map((badgeId: any) => ({
              start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
              end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
            }))
            : [],
          ownershipTimes: Array.isArray(balance.ownershipTimes) && balance.ownershipTimes.every((badgeId: any) => typeof badgeId === "object")
            ? balance.ownershipTimes.map((badgeId: any) => ({
              start: badgeId.start ? BigInt(badgeId.start).toString() : "-1",
              end: badgeId.end ? BigInt(badgeId.end).toString() : "-1",
            }))
            : [],
        })) : [];

      return res.status(200).send({
        balance: {
          collectionId: req.params.collectionId,
          cosmosAddress: req.params.cosmosAddress,
          balances: balances.map(x => convertBalance(x, BigIntify)),

          incomingApprovals: [],
          outgoingApprovals: [],
          autoApproveSelfInitiatedOutgoingTransfers: collection.defaultAutoApproveSelfInitiatedOutgoingTransfers,
          autoApproveSelfInitiatedIncomingTransfers: collection.defaultAutoApproveSelfInitiatedIncomingTransfers,
          userPermissions: {
            canUpdateAutoApproveSelfInitiatedIncomingTransfers: [],
            canUpdateAutoApproveSelfInitiatedOutgoingTransfers: [],
            canUpdateIncomingApprovals: [],
            canUpdateOutgoingApprovals: [],
          },
          onChain: false,
          updateHistory: [],
          _legacyId: req.params.collectionId + ':' + cosmosAddress
        }
      });
    }

    const response = await getFromDB(BalanceModel, docId);

    let addressMappingIdsToFetch = [];
    for (const incoming of collection.defaultUserIncomingApprovals) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of collection.defaultUserOutgoingApprovals) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of response?.incomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of response?.outgoingApprovals ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of response?.userPermissions.canUpdateIncomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of response?.userPermissions.canUpdateOutgoingApprovals ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    for (const incoming of collection?.defaultUserPermissions?.canUpdateIncomingApprovals ?? []) {
      addressMappingIdsToFetch.push(incoming.fromMappingId, incoming.initiatedByMappingId);
    }

    for (const outgoing of collection?.defaultUserPermissions?.canUpdateOutgoingApprovals ?? []) {
      addressMappingIdsToFetch.push(outgoing.toMappingId, outgoing.initiatedByMappingId);
    }

    const addressMappings = await getAddressMappingsFromDB(addressMappingIdsToFetch.map(id => {
      return {
        mappingId: id,
        collectionId: req.params.collectionId
      }
    }), false);

    const balanceToReturn = response ? convertBalanceDoc(response, Stringify) :
      {
        collectionId: req.params.collectionId,
        cosmosAddress: req.params.cosmosAddress,
        balances: [],
        incomingApprovals: collection.defaultUserIncomingApprovals,
        outgoingApprovals: collection.defaultUserOutgoingApprovals,
        autoApproveSelfInitiatedOutgoingTransfers: collection.defaultAutoApproveSelfInitiatedOutgoingTransfers,
        autoApproveSelfInitiatedIncomingTransfers: collection.defaultAutoApproveSelfInitiatedIncomingTransfers,
        userPermissions: collection.defaultUserPermissions,
        onChain: collection.balancesType === "Standard",
        updateHistory: [],
        _legacyId: req.params.collectionId + ':' + cosmosAddress
      }



    const balanceToReturnConverted: BalanceDocWithDetails<string> = {
      ...balanceToReturn,
      incomingApprovals: appendDefaultForIncomingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
      outgoingApprovals: appendDefaultForOutgoingUserApprovals(balanceToReturn, addressMappings, req.params.cosmosAddress),
      userPermissions: convertUserPermissionsWithDetails(applyAddressMappingsToUserPermissions(balanceToReturn.userPermissions, addressMappings), Stringify),
    }


    return res.status(200).send({
      balance: balanceToReturnConverted,
    });


  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error getting badge balances"
    });
  }
}