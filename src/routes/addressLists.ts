import {
  AddressListDoc,
  ListActivityDoc,
  convertToCosmosAddress,
  iClaimBuilderDoc,
  type DeleteAddressListsRouteRequestBody,
  type ErrorResponse,
  type GetAddressListsRouteRequestBody,
  type JSPrimitiveNumberType,
  type NumberType,
  type StatusDoc,
  type UpdateAddressListsRouteRequestBody,
  type iAddressList,
  type iDeleteAddressListsRouteSuccessResponse,
  type iGetAddressListsRouteSuccessResponse,
  type iUpdateAddressListsRouteSuccessResponse,
  AddressList
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { encryptPlugins } from '../integrations/types';
import { checkIfAuthenticated, returnUnauthorized, type AuthenticatedRequest, type MaybeAuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, getFromDB, insertMany, mustGetManyFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AddressListModel, ClaimBuilderModel, ListActivityModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { Plugins } from './claims';
import { getClaimDetailsForFrontend } from './collections';
import { getAddressListsFromDB } from './utils';
import { assertPluginsUpdateIsValid } from './ipfs';

export const deleteAddressLists = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iDeleteAddressListsRouteSuccessResponse | ErrorResponse>
) => {
  try {
    const reqBody = req.body as DeleteAddressListsRouteRequestBody;
    const listIds = reqBody.listIds;

    if (listIds.length > 100) {
      throw new Error('You can only delete up to 100 address lists at a time.');
    }

    const docsToDelete = await mustGetManyFromDB(AddressListModel, listIds);
    for (const doc of docsToDelete) {
      if (doc.createdBy !== req.session.cosmosAddress) {
        throw new Error('You are not the owner of list with ID ' + doc._docId);
      }

      if (!doc.listId.includes('_')) {
        throw new Error('You cannot delete a list that was created on-chain.');
      }
    }

    //TODO: session?
    const docs = await findInDB(ClaimBuilderModel, { query: { 'action.listId': { $in: listIds } } });
    await deleteMany(
      AddressListModel,
      docsToDelete.map((x) => x._docId)
    );

    if (docs.length > 0) {
      await deleteMany(
        ClaimBuilderModel,
        docs.map((x) => x._docId)
      );
    }

    return res.status(200).send({});
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting address lists.'
    });
  }
};

export function getActivityDocsForListUpdate(
  list: iAddressList,
  existingDoc: iAddressList,
  status: StatusDoc<NumberType>,
  activityDocs: Array<ListActivityDoc<NumberType>>
) {
  const newAddressesNotInOld = list.addresses.filter((x) => !existingDoc.addresses.includes(x));
  const oldAddressesNotInNew = existingDoc.addresses.filter((x) => !list.addresses.includes(x));

  if (newAddressesNotInOld.length > 0) {
    activityDocs.push(
      new ListActivityDoc({
        _docId: crypto.randomBytes(16).toString('hex'),
        addresses: newAddressesNotInOld.map((x) => convertToCosmosAddress(x)),
        addedToList: true,
        listId: list.listId,
        timestamp: Date.now(),
        block: status?.block.height ?? 0n
      })
    );
  }

  if (oldAddressesNotInNew.length > 0) {
    activityDocs.push(
      new ListActivityDoc({
        _docId: crypto.randomBytes(16).toString('hex'),
        addresses: oldAddressesNotInNew.map((x) => convertToCosmosAddress(x)),
        addedToList: false,
        listId: list.listId,
        timestamp: Date.now(),
        block: status?.block.height ?? 0n
      })
    );
  }
}

export const createAddressLists = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateAddressListsRouteSuccessResponse | ErrorResponse>
) => {
  return handleAddressListsUpdateAndCreate(req, res, true);
};

const handleAddressListsUpdateAndCreate = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateAddressListsRouteSuccessResponse | ErrorResponse>,
  isCreation?: boolean
) => {
  const isUpdate = !isCreation;
  try {
    const reqBody = req.body as UpdateAddressListsRouteRequestBody<JSPrimitiveNumberType>;
    const lists = reqBody.addressLists;
    const cosmosAddress = req.session.cosmosAddress;

    if (lists.length > 100) {
      throw new Error('You can only update up to 100 address lists at a time.');
    }

    for (const list of lists) {
      const prefix = cosmosAddress + '_';
      if (!list.listId.startsWith(prefix)) {
        throw new Error('List ID must start with ' + prefix);
      }

      const cosmosAddresses = list.addresses.map((x) => convertToCosmosAddress(x));
      if (cosmosAddresses.length !== new Set(cosmosAddresses).size) {
        throw new Error('Duplicate addresses found in list');
      }
    }

    const status = await getStatus();
    const docs: Array<AddressListDoc<NumberType>> = [];

    const activityDocs: Array<ListActivityDoc<NumberType>> = [];
    const claimBuilderDocs: Array<iClaimBuilderDoc<NumberType>> = [];
    const claimDocsToDelete: string[] = [];
    for (const list of lists) {
      const existingDoc = await getFromDB(AddressListModel, list.listId);
      if (isCreation && existingDoc) {
        throw new Error('List with ID ' + list.listId + ' already exists.');
      }

      if (isUpdate && !existingDoc) {
        throw new Error('List with ID ' + list.listId + ' does not exist.');
      }

      for (const claim of list.claims) {
        const claimDocs = await findInDB(ClaimBuilderModel, { query: { 'action.listId': list.listId, _docId: claim.claimId }, limit: 1 });
        const plugins = encryptPlugins(claim.plugins ?? []);

        const state: Record<string, any> = {};
        for (let i = 0; i < plugins.length; i++) {
          const plugin = plugins[i];
          const passedInPlugin = claim.plugins[i];

          state[plugin.id] = Plugins[plugin.id].defaultState;
          if (claimDocs.length > 0 && !passedInPlugin.resetState) {
            state[plugin.id] = claimDocs[0].state[plugin.id];
          }
        }

        if (claimDocs.length === 0) {
          claimBuilderDocs.push({
            _docId: claim.claimId,
            createdBy: req.session.cosmosAddress,
            collectionId: '-1',
            docClaimed: true,
            cid: '',
            action: {
              listId: list.listId
            },
            state,
            plugins: plugins ?? []
          });
        } else {
          assertPluginsUpdateIsValid(claimDocs[0].plugins, plugins);

          //Keep state if claim already exists
          claimBuilderDocs.push({
            ...claimDocs[0],
            state,
            plugins: plugins ?? []
          });
        }
      }

      //Delete all old claims that are not in the new stuff
      const claimDocs = await findInDB(ClaimBuilderModel, {
        query: { 'action.listId': list.listId, _docId: { $nin: list.claims.map((x) => x.claimId) } }
      });
      const docIdsToDelete = claimDocs.map((x) => x._docId);
      claimDocsToDelete.push(...docIdsToDelete);

      if (existingDoc) {
        if (existingDoc.createdBy !== cosmosAddress) {
          throw new Error('You are not the owner of list with ID ' + list.listId);
        }

        if (existingDoc.whitelist !== list.whitelist) {
          throw new Error('You cannot change from a whitelist to a blacklist or vice versa.');
        }

        docs.push(
          new AddressListDoc<NumberType>({
            ...existingDoc,
            ...list,
            addresses: list.addresses.map((x) => convertToCosmosAddress(x)),
            updateHistory: [
              ...existingDoc.updateHistory,
              {
                block: status.block.height,
                blockTimestamp: status.block.timestamp,
                txHash: '',
                timestamp: Date.now()
              }
            ],
            lastUpdated: status.block.timestamp
          })
        );

        getActivityDocsForListUpdate(list, existingDoc, status, activityDocs);
      } else {
        docs.push(
          new AddressListDoc<NumberType>({
            ...list,
            addresses: list.addresses.map((x) => convertToCosmosAddress(x)),
            createdBy: cosmosAddress,
            updateHistory: [
              {
                block: status.block.height,
                blockTimestamp: status.block.timestamp,
                txHash: '',
                timestamp: Date.now()
              }
            ],
            _docId: list.listId,
            createdBlock: status.block.height,
            lastUpdated: status.block.timestamp
          })
        );

        if (list.addresses.length > 0) {
          activityDocs.push(
            new ListActivityDoc<NumberType>({
              _docId: crypto.randomBytes(16).toString('hex'),
              addresses: list.addresses.map((x) => convertToCosmosAddress(x)),
              addedToList: true,
              listId: list.listId,
              timestamp: Date.now(),
              block: status?.block.height ?? 0n
            })
          );
        }
      }
    }

    // TODO: Session?
    await insertMany(AddressListModel, docs);
    await insertMany(ListActivityModel, activityDocs);
    await insertMany(ClaimBuilderModel, claimBuilderDocs);
    await deleteMany(ClaimBuilderModel, claimDocsToDelete);

    return res.status(200).send({});
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error creating address lists.'
    });
  }
};

export const updateAddressLists = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iUpdateAddressListsRouteSuccessResponse | ErrorResponse>
) => {
  return handleAddressListsUpdateAndCreate(req, res);
};

export const getAddressLists = async (req: Request, res: Response<iGetAddressListsRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    // console.time('getAddressLists');
    const reqBody = req.body as GetAddressListsRouteRequestBody;
    const listsToFetch = reqBody.listsToFetch;

    if (listsToFetch.length > 100) {
      throw new Error('You can only fetch up to 100 address lists at a time.');
    }

    // console.time('getAddressListsFromDB');
    const docs = await getAddressListsFromDB(listsToFetch, true);
    // console.timeEnd('getAddressListsFromDB');

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const query = listsToFetch[i];
      if (doc.private) {
        if (doc.viewableWithLink) continue;

        const authReq = req as MaybeAuthenticatedRequest<NumberType>;
        if (!checkIfAuthenticated(authReq)) return returnUnauthorized(res);

        const cosmosAddress = authReq.session.cosmosAddress;
        if (docs.some((x) => x.private && x.createdBy !== cosmosAddress)) {
          return res.status(401).send({
            errorMessage: `Your signed in address ${authReq.session.address} does not have permission to view one or more of the requested address lists.`
          });
        }
      }

      let isReserved = false;
      try {
        AddressList.getReservedAddressList(doc.listId);
        isReserved = true;
      } catch (e) {}

      if (isReserved) continue;

      // console.time('getClaimDocs');
      const claimDocs = await findInDB(ClaimBuilderModel, { query: { 'action.listId': doc.listId } });
      doc.claims = await getClaimDetailsForFrontend(req, claimDocs, query.fetchPrivateParams, undefined, doc.listId);
      // console.timeEnd('getClaimDocs');
    }

    // console.timeEnd('getAddressLists');

    return res.status(200).send({ addressLists: docs });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching address lists.'
    });
  }
};
