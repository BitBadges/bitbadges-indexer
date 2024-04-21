import {
  AddressListDoc,
  ListActivityDoc,
  convertToCosmosAddress,
  type iClaimBuilderDoc,
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
      if (doc.createdBy !== req.session.cosmosAddress || !doc.listId.startsWith(req.session.cosmosAddress + '_')) {
        throw new Error('You are not the owner of list with ID ' + doc._docId);
      }

      if (!doc.listId.includes('_')) {
        throw new Error('You cannot delete a list that was created on-chain.');
      }
    }

    // TODO: session?
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

    return res.status(200).send();
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error deleting address lists.'
    });
  }
};

export function getActivityDocsForListUpdate(
  list: iAddressList,
  existingDoc: iAddressList | undefined,
  status: StatusDoc<NumberType>,
  activityDocs: Array<ListActivityDoc<NumberType>>
) {
  const existingAddresses = existingDoc?.addresses ?? [];
  const newAddressesNotInOld = list.addresses.filter((x) => !existingAddresses.includes(x));
  const oldAddressesNotInNew = existingAddresses.filter((x) => !list.addresses.includes(x));

  if (newAddressesNotInOld.length > 0) {
    activityDocs.push(
      new ListActivityDoc({
        _docId: crypto.randomBytes(32).toString('hex'),
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
        _docId: crypto.randomBytes(32).toString('hex'),
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
  return await handleAddressListsUpdateAndCreate(req, res, true);
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
        const encryptedPlugins = encryptPlugins(claim.plugins ?? []);

        const hasExistingClaim = claimDocs.length > 0;
        const existingClaim = claimDocs?.[0];
        const state: Record<string, object> = {};
        for (let i = 0; i < encryptedPlugins.length; i++) {
          const encryptedPlugin = encryptedPlugins[i];
          const passedInPlugin = claim.plugins[i];
          const id = encryptedPlugin.id;

          state[id] = Plugins[id].defaultState;
          if (hasExistingClaim && !passedInPlugin.resetState) {
            state[id] = existingClaim.state[id];
          }
        }

        if (!hasExistingClaim) {
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
            plugins: encryptedPlugins ?? []
          });
        } else {
          assertPluginsUpdateIsValid(existingClaim.plugins, encryptedPlugins);
          claimBuilderDocs.push({
            ...existingClaim,
            state,
            plugins: encryptedPlugins ?? []
          });
        }
      }

      // Delete all old claims that are not in the new stuff
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
      }

      docs.push(
        new AddressListDoc<NumberType>({
          ...existingDoc,
          ...list,
          _docId: list.listId,
          createdBlock: existingDoc?.createdBlock ?? status.block.height,
          createdBy: existingDoc?.createdBy ?? cosmosAddress,
          lastUpdated: status.block.timestamp,
          addresses: list.addresses.map((x) => convertToCosmosAddress(x)),
          updateHistory: [
            ...(existingDoc?.updateHistory ?? []),
            {
              block: status.block.height,
              blockTimestamp: status.block.timestamp,
              txHash: '',
              timestamp: Date.now()
            }
          ]
        })
      );

      getActivityDocsForListUpdate(list, existingDoc, status, activityDocs);
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
  return await handleAddressListsUpdateAndCreate(req, res);
};

const isReserved = (listId: string) => {
  try {
    AddressList.getReservedAddressList(listId);
    return true;
  } catch (e) {
    return false;
  }
};

export const getAddressLists = async (req: Request, res: Response<iGetAddressListsRouteSuccessResponse<NumberType> | ErrorResponse>) => {
  try {
    const reqBody = req.body as GetAddressListsRouteRequestBody;
    const listsToFetch = reqBody.listsToFetch;

    if (listsToFetch.length > 100) {
      throw new Error('You can only fetch up to 100 address lists at a time.');
    }

    const reservedStatuses = listsToFetch.map((x) => isReserved(x.listId));
    const docs = await getAddressListsFromDB(
      listsToFetch,
      reservedStatuses.some((x) => !x) // Reserved lists will not have metadata
    );

    // Private lists that are not viewable by ID can only be viewed by the creator
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const query = listsToFetch[i];
      const isReserved = reservedStatuses[i];
      if (isReserved) continue; // Reserved lists will not have claims, privacy restrictions, etc

      // If it is viewable by link / ID, they have requested it via the API call so they know the link
      if (doc.private && !doc.viewableWithLink) {
        const authReq = req as MaybeAuthenticatedRequest<NumberType>;
        if (!checkIfAuthenticated(authReq, ['Read Address Lists'])) return returnUnauthorized(res);

        const cosmosAddress = authReq.session.cosmosAddress;
        if (doc.createdBy !== cosmosAddress) {
          return res.status(401).send({
            errorMessage: `You do not have permission to view one or more of the requested address lists. The list with ID ${doc.listId} is private and viewable only by the creator.`
          });
        }
      }

      const claimDocs = await findInDB(ClaimBuilderModel, { query: { 'action.listId': doc.listId } });
      doc.claims = await getClaimDetailsForFrontend(req, claimDocs, query.fetchPrivateParams, undefined, doc.listId);
    }

    return res.status(200).send({ addressLists: docs });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error fetching address lists.'
    });
  }
};
