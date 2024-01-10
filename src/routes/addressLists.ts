import { JSPrimitiveNumberType, Stringify } from "bitbadgesjs-proto";
import { AddressListDoc, DeleteAddressListsRouteResponse, GetAddressListsRouteRequestBody, GetAddressListsRouteResponse, ListActivityDoc, NumberType, UpdateAddressListsRouteRequestBody, UpdateAddressListsRouteResponse, convertAddressListDoc, convertAddressListEditKey, convertToCosmosAddress } from "bitbadgesjs-utils";
import { Request, Response } from "express";
import { serializeError } from "serialize-error";
import { AuthenticatedRequest, checkIfAuthenticated, returnUnauthorized } from "../blockin/blockin_handlers";
import { AddressListModel, ListActivityModel, deleteMany, getFromDB, insertMany, mustGetManyFromDB } from "../db/db";
import { getStatus } from "../db/status";
import { getAddressListsFromDB } from "./utils";
import crypto from 'crypto';

export const deleteAddressLists = async (expressReq: Request, res: Response<DeleteAddressListsRouteResponse<bigint>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<NumberType>;
    const reqBody = req.body as GetAddressListsRouteRequestBody;
    const listIds = reqBody.listIds;

    if (listIds.length > 100) {
      throw new Error("You can only delete up to 100 address lists at a time.");
    }

    const docsToDelete = await mustGetManyFromDB(AddressListModel, listIds);
    for (const doc of docsToDelete) {
      if (doc.createdBy !== req.session.cosmosAddress) {
        throw new Error("You are not the owner of list with ID " + doc._docId);
      }

      if (!doc.listId.includes("_")) {
        throw new Error("You cannot delete a list that was created on-chain.");
      }
    }

    await deleteMany(AddressListModel, docsToDelete.map(x => x._docId));

    return res.status(200).send({})
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error deleting address lists. Please try again later."
    })
  }
}


export const updateAddressLists = async (expressReq: Request, res: Response<UpdateAddressListsRouteResponse<bigint>>) => {
  try {
    const req = expressReq as AuthenticatedRequest<JSPrimitiveNumberType>;
    const reqBody = req.body as UpdateAddressListsRouteRequestBody<JSPrimitiveNumberType>;
    const lists = reqBody.addressLists;
    const cosmosAddress = req.session.cosmosAddress;

    if (lists.length > 100) {
      throw new Error("You can only update up to 100 address lists at a time.");
    }

    for (const list of lists) {
      const prefix = cosmosAddress + "_";
      if (!list.listId.startsWith(prefix)) {
        throw new Error("List ID must start with " + prefix);
      }
    }

    const status = await getStatus();
    const docs: AddressListDoc<JSPrimitiveNumberType>[] = [];

    const activityDocs: ListActivityDoc<JSPrimitiveNumberType>[] = [];

    for (const list of lists) {
      const _existingDoc = await getFromDB(AddressListModel, list.listId);

      if (_existingDoc) {
        const existingDoc = convertAddressListDoc(_existingDoc, Stringify);
        if (existingDoc.createdBy !== cosmosAddress) {
          throw new Error("You are not the owner of list with ID " + list.listId);
        }

        if (existingDoc.allowlist !== list.allowlist) {
          throw new Error("You cannot change from a whitelist to a blocklist or vice versa.");
        }

        docs.push({
          ...existingDoc,
          ...list,
          editKeys: list.editKeys ? list.editKeys.map(x => convertAddressListEditKey(x, Stringify)) : existingDoc.editKeys,
          addresses: list.addresses.map(x => convertToCosmosAddress(x)),
          updateHistory: [...existingDoc.updateHistory, {
            block: status.block.height,
            blockTimestamp: status.block.timestamp,
            txHash: '',
          }],
          lastUpdated: status.block.timestamp,
        })

        //we really have three statuses: include, excluded, and deleted
        if (existingDoc.allowlist !== list.allowlist) {
          const newAddressesNotInOld = list.addresses.filter(x => !existingDoc.addresses.includes(x));
          const oldAddressesNotInNew = existingDoc.addresses.filter(x => !list.addresses.includes(x));

          if (newAddressesNotInOld.length > 0) {
            activityDocs.push({
              _docId: crypto.randomBytes(16).toString('hex'),
              addresses: newAddressesNotInOld.map(x => convertToCosmosAddress(x)),
              addedToList: true,
              listId: list.listId,
              timestamp: Date.now(),
              block: status?.block.height ?? 0n,
            })
          }

          if (oldAddressesNotInNew.length > 0) {
            activityDocs.push({
              _docId: crypto.randomBytes(16).toString('hex'),
              addresses: oldAddressesNotInNew.map(x => convertToCosmosAddress(x)),
              addedToList: false,
              listId: list.listId,
              timestamp: Date.now(),
              block: status?.block.height ?? 0n,
            })
          }
        }

      } else {
        docs.push({
          ...list,
          editKeys: list.editKeys ? list.editKeys.map(x => convertAddressListEditKey(x, Stringify)) : undefined,
          addresses: list.addresses.map(x => convertToCosmosAddress(x)),
          createdBy: cosmosAddress,
          updateHistory: [{
            block: status.block.height,
            blockTimestamp: status.block.timestamp,
            txHash: '',
          }],
          _docId: list.listId,
          createdBlock: status.block.height,
          lastUpdated: status.block.timestamp,
        });

        activityDocs.push({
          _docId: crypto.randomBytes(16).toString('hex'),
          addresses: list.addresses.map(x => convertToCosmosAddress(x)),
          addedToList: true,
          listId: list.listId,
          timestamp: Date.now(),
          block: status?.block.height ?? 0n,
        })
      }
    }

    await insertMany(AddressListModel, docs);
    await insertMany(ListActivityModel, activityDocs);

    return res.status(200).send({})
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error creating address lists. Please try again later."
    })
  }
}

export const getAddressLists = async (req: Request, res: Response<GetAddressListsRouteResponse<NumberType>>) => {
  try {
    const reqBody = req.body as GetAddressListsRouteRequestBody;
    let listIds = reqBody.listIds;

    if (listIds.length > 100) {
      throw new Error("You can only fetch up to 100 address lists at a time.");
    }

    const docs = await getAddressListsFromDB(listIds.map(x => { return { listId: x } }), true);

    const hasPrivateList = docs.find(x => x.private);
    if (hasPrivateList) {
      const authReq = req as AuthenticatedRequest<NumberType>;

      if (!checkIfAuthenticated(authReq)) return returnUnauthorized(res);

      const cosmosAddress = authReq.session.cosmosAddress;
      if (docs.some(x => x.private && x.createdBy !== cosmosAddress)) {
        return res.status(401).send({
          message: `Your signed in address ${authReq.session.address} does not have permission to view one or more of the requested address lists.`
        })
      }
    }

    return res.status(200).send({ addressLists: docs });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      message: "Error fetching address lists. Please try again later."
    })
  }
}
