import {
  ClaimIntegrationPrivateParamsType,
  ClaimIntegrationPrivateStateType,
  ClaimIntegrationPublicParamsType,
  CollectionApprovalWithDetails,
  CreateClaimRequest,
  UpdateClaimRequest,
  deepCopyPrimitives,
  iBadgeMetadataDetails,
  iChallengeDetails,
  iChallengeTrackerIdDetails,
  iClaimBuilderDoc,
  iClaimDetails,
  iCollectionMetadataDetails,
  iMetadata,
  iPredeterminedBalances,
  validateCollectionApprovalsUpdate,
  type AddApprovalDetailsToOffChainStoragePayload,
  type AddBalancesToOffChainStoragePayload,
  type AddToIpfsPayload,
  type ClaimIntegrationPluginType,
  type ErrorResponse,
  type IntegrationPluginParams,
  type NumberType,
  type iAddApprovalDetailsToOffChainStorageSuccessResponse,
  type iAddBalancesToOffChainStorageSuccessResponse,
  type iAddToIpfsSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { Request, type Response } from 'express';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import typia from 'typia';
import { checkIfManager, mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import {
  AddressListModel,
  ClaimBuilderModel,
  ClaimDocHistoryModel,
  CollectionModel,
  IPFSTotalsModel,
  OffChainUrlModel,
  PluginModel
} from '../db/schemas';
import { Plugins, encryptPlugins, getFirstMatchForPluginType, getPlugin } from '../integrations/types';
import { addApprovalDetailsToOffChainStorage, addBalancesToOffChainStorage, addMetadataToIpfs } from '../ipfs/ipfs';
import { cleanBalanceMap } from '../utils/dataCleaners';
import { createOffChainClaimContextFunction, createOnChainClaimContextFunction } from './claims';
import { executeCollectionsQuery, getDecryptedPluginsAndPublicState } from './collections';
import { refreshCollection } from './refresh';
import { typiaError } from './search';

const IPFS_UPLOAD_BYTES_LIMIT = 1000000000; // 1GB

// will throw error if limit exceeded
export const checkIpfsTotals = async (address: string, size: number) => {
  await updateIpfsTotals(address, size, true);
};

export const updateIpfsTotals = async (address: string, size: number, doNotInsert?: boolean) => {
  const ipfsTotalsDoc = (await getFromDB(IPFSTotalsModel, address)) ?? {
    _docId: address,
    _rev: undefined,
    bytesUploaded: 0n
  };
  ipfsTotalsDoc.bytesUploaded += BigInt(size);

  if (ipfsTotalsDoc.bytesUploaded > IPFS_UPLOAD_BYTES_LIMIT) {
    throw new Error('You have exceeded your IPFS storage limit.');
  }

  if (!doNotInsert) await insertToDB(IPFSTotalsModel, ipfsTotalsDoc);
};

export const assertPluginsUpdateIsValid = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response,
  oldPlugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  newPlugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  oldAssignMethod: string | undefined,
  newAssignMethod: string | undefined,
  isNonIndexed?: boolean
) => {
  // cant change assignmethods

  // const oldNumUses = getFirstMatchForPluginType('numUses', oldPlugins);
  const newNumUses = getFirstMatchForPluginType('numUses', newPlugins);

  if (!newNumUses && !isNonIndexed) {
    throw new Error('numUses plugin is required');
  }

  //Assert no duplicate IDs
  for (const plugin of newPlugins) {
    if (newPlugins.filter((x) => x.instanceId === plugin.instanceId).length > 1) {
      throw new Error('Duplicate instance IDs are not allowed');
    }
  }

  //Assert plugin IDs are alphanumeric
  for (const plugin of newPlugins) {
    if (!/^[a-zA-Z0-9]*$/.test(plugin.instanceId)) {
      throw new Error('Plugin instance IDs must be alphanumeric');
    }
  }

  for (const plugin of Object.entries(Plugins)) {
    const duplicatesAllowed = plugin[1].metadata.duplicatesAllowed;
    if (duplicatesAllowed) continue;

    if (newPlugins.filter((x) => x.pluginId === plugin[0]).length > 1) {
      throw new Error('Duplicate plugins are not allowed for type: ' + plugin[0]);
    }
  }

  const newPluginTypes = newPlugins.map((x) => x.pluginId).filter((x) => !oldPlugins.map((y) => y.pluginId).includes(x));
  for (const type of newPluginTypes) {
    if (!Plugins[type]) {
      const authDetails = await mustGetAuthDetails(req, res);
      const doc = await mustGetFromDB(PluginModel, type);
      if (!doc.reviewCompleted && doc.createdBy !== authDetails.cosmosAddress && !doc.approvedUsers.includes(authDetails.cosmosAddress)) {
        throw new Error('You must be the owner of non-published plugins or approved to use them by the owner.');
      }
    }
  }

  if (!newAssignMethod || newAssignMethod === 'firstComeFirstServe') {
    // Defaults to incrementing claim numbers
  } else {
    //Assert that exactly one plugin instance ID is set to assign the claim number
    let found = false;
    for (const plugin of newPlugins) {
      if (plugin.instanceId === newAssignMethod) {
        if (found) {
          throw new Error('Only one plugin can assign the claim number');
        }

        found = true;
      }
    }

    //We should also fail if it doesn't match any
    if (!found) {
      throw new Error('Assign method must match a plugin instance ID, be blank / empty, or be firstComeFirstServe');
    }
  }

  for (const plugin of newPlugins) {
    switch (plugin.pluginId) {
      case 'numUses':
        typia.assert<ClaimIntegrationPublicParamsType<'numUses'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'numUses'>>(plugin.privateParams ?? {});
        break;
      case 'whitelist':
        typia.assert<ClaimIntegrationPublicParamsType<'whitelist'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'whitelist'>>(plugin.privateParams ?? {});
        break;
      case 'password':
        typia.assert<ClaimIntegrationPublicParamsType<'password'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'password'>>(plugin.privateParams ?? {});
        break;
      case 'codes':
        typia.assert<ClaimIntegrationPublicParamsType<'codes'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'codes'>>(plugin.privateParams ?? {});
        break;
      case 'transferTimes':
        typia.assert<ClaimIntegrationPublicParamsType<'transferTimes'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'transferTimes'>>(plugin.privateParams ?? {});
        break;
      case 'initiatedBy':
        typia.assert<ClaimIntegrationPublicParamsType<'initiatedBy'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'initiatedBy'>>(plugin.privateParams ?? {});
        break;
      case 'github':
        typia.assert<ClaimIntegrationPublicParamsType<'github'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'github'>>(plugin.privateParams ?? {});
        break;
      case 'google':
        typia.assert<ClaimIntegrationPublicParamsType<'google'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'google'>>(plugin.privateParams ?? {});
        break;
      case 'twitter':
        typia.assert<ClaimIntegrationPublicParamsType<'twitter'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'twitter'>>(plugin.privateParams ?? {});
        break;
      case 'discord':
        typia.assert<ClaimIntegrationPublicParamsType<'discord'>>(plugin.publicParams ?? {});
        typia.assert<ClaimIntegrationPrivateParamsType<'discord'>>(plugin.privateParams ?? {});
        break;
      default:
      //Not a core plugin
    }
  }
};

export enum ClaimType {
  OnChain = 'On-Chain',
  OffChainNonIndexed = 'Off-Chain - Non-Indexed',
  OffChainIndexed = 'Off-Chain - Indexed',
  AddressList = 'Address List'
}

const constructQuery = (claimType: ClaimType, oldClaimQuery: Record<string, any>) => {
  const query: Record<string, any> = {};
  if (claimType === ClaimType.OffChainIndexed || claimType === ClaimType.OffChainNonIndexed) {
    query.collectionId = Number(oldClaimQuery.collectionId) ?? -10000;
  }

  if (claimType === ClaimType.AddressList) {
    query['action.listId'] = {
      $eq: oldClaimQuery['action.listId'] ?? ''
    };
  }

  return query;
};

export interface ContextReturn {
  action: {
    codes?: string[];
    seedCode?: string;
    balancesToSet?: iPredeterminedBalances<NumberType>;
    listId?: string;
  };
  metadata?: iMetadata<NumberType>;
  approach?: string;
  createdBy: string;
  collectionId: NumberType;
  docClaimed: boolean;
  cid: string;
  manualDistribution?: boolean;
  trackerDetails?: iChallengeTrackerIdDetails<NumberType>;
}

function deepMerge(target: Record<string, any>, source: Record<string, any>) {
  // Check if the source is an object and not null
  if (typeof source === 'object' && source !== null) {
    // Iterate through each key in the source
    for (const key in source) {
      // If the source property is also an object, recursively merge
      if (typeof source[key] === 'object' && source[key] !== null) {
        if (!target[key]) {
          target[key] = {};
        }
        deepMerge(target[key], source[key]);
      } else {
        // Otherwise, directly assign the value
        target[key] = source[key];
      }
    }
  }
  return target;
}

export const updateClaimDocs = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response,
  claimType: ClaimType,
  oldClaimQuery: Record<string, any>,
  newClaims: Array<CreateClaimRequest<NumberType> | UpdateClaimRequest<NumberType>>,
  context: (claim: CreateClaimRequest<NumberType> | UpdateClaimRequest<NumberType>) => ContextReturn,
  session?: mongoose.ClientSession,
  isCreation?: boolean
) => {
  const queryBuilder = constructQuery(claimType, oldClaimQuery);
  const authDetails = await mustGetAuthDetails(req, res);

  // Basic sanitization of newClaims
  for (const claim of newClaims) {
    if (typeof claim !== 'object') {
      throw new Error('Invalid claim');
    }

    if (typeof claim.claimId !== 'string') throw new Error('Invalid claim');
    if (!Array.isArray(claim.plugins)) throw new Error('Invalid claim plugins');
    for (const plugin of claim.plugins) {
      if (typeof plugin !== 'object') throw new Error('Invalid plugin');
      if (typeof plugin.pluginId !== 'string') throw new Error('Invalid plugin');
      if (typeof plugin.instanceId !== 'string') throw new Error('Invalid plugin');
      if (plugin.newState && typeof plugin.newState !== 'object') throw new Error('Invalid plugin new state');
    }
  }

  const claimDocsToSet: Array<iClaimBuilderDoc<NumberType>> = [];
  const historyDocsToSet: Array<any> = [];
  for (const claim of newClaims ?? []) {
    if (!claim.claimId) {
      throw new Error('Invalid claim');
    }

    const query = { docClaimed: true, _docId: { $eq: claim.claimId }, ...queryBuilder };
    const existingDocRes = await findInDB(ClaimBuilderModel, { query, limit: 1, session });
    const existingDoc = existingDocRes.length > 0 ? existingDocRes[0] : undefined;
    const pluginsWithOptions = deepCopyPrimitives(claim.plugins ?? []);
    const encryptedPlugins = await encryptPlugins(claim.plugins ?? []);

    const state: Record<string, any> = {};
    for (const plugin of pluginsWithOptions ?? []) {
      const pluginObj = await getPlugin(plugin.pluginId);
      state[plugin.instanceId] = existingDoc?.state[plugin.instanceId] ?? pluginObj.defaultState;
      if (plugin.resetState) {
        state[plugin.instanceId] = pluginObj.defaultState;
      } else if (plugin.newState) {
        //sanitize the new state

        if (plugin.onlyUpdateProvidedNewState) {
          state[plugin.instanceId] = deepMerge(state[plugin.instanceId], plugin.newState);
        } else {
          //Completely overwrite the state
          state[plugin.instanceId] = plugin.newState;
        }

        //validate it
        switch (plugin.pluginId) {
          case 'numUses':
            typia.assert<ClaimIntegrationPrivateStateType<'numUses'>>(state[plugin.instanceId]);
            break;
          case 'whitelist':
            typia.assert<ClaimIntegrationPrivateStateType<'whitelist'>>(state[plugin.instanceId]);
            break;
          case 'password':
            typia.assert<ClaimIntegrationPrivateStateType<'password'>>(state[plugin.instanceId]);
            break;
          case 'codes':
            typia.assert<ClaimIntegrationPrivateStateType<'codes'>>(state[plugin.instanceId]);
            break;
          case 'transferTimes':
            typia.assert<ClaimIntegrationPrivateStateType<'transferTimes'>>(state[plugin.instanceId]);
            break;
          case 'initiatedBy':
            typia.assert<ClaimIntegrationPrivateStateType<'initiatedBy'>>(state[plugin.instanceId]);
            break;
          case 'github':
            typia.assert<ClaimIntegrationPrivateStateType<'github'>>(state[plugin.instanceId]);
            break;
          case 'google':
            typia.assert<ClaimIntegrationPrivateStateType<'google'>>(state[plugin.instanceId]);
            break;
          case 'twitter':
            typia.assert<ClaimIntegrationPrivateStateType<'twitter'>>(state[plugin.instanceId]);
            break;
          case 'discord':
            typia.assert<ClaimIntegrationPrivateStateType<'discord'>>(state[plugin.instanceId]);
            break;
          default:
          //Not a core plugin
        }
      }

      if (plugin.resetState && plugin.newState) {
        throw new Error('Cannot set both resetState and newState');
      }

      if (claimType == ClaimType.OnChain && plugin.pluginId === 'numUses' && existingDoc && plugin.resetState) {
        throw new Error('numUses plugin is not allowed to be reset for approval claims');
      }
    }

    const isNonIndexed = claimType === ClaimType.OffChainNonIndexed;
    await assertPluginsUpdateIsValid(
      req,
      res,
      existingDoc?.plugins ?? [],
      claim.plugins ?? [],
      existingDoc?.assignMethod,
      existingDoc?.assignMethod ?? (claim as CreateClaimRequest<NumberType>).assignMethod,
      isNonIndexed
    );

    if (claimType == ClaimType.AddressList) {
      if (!isCreation) {
        const listDoc = await mustGetFromDB(AddressListModel, context(claim).action.listId ?? '');
        if (!listDoc || !listDoc.listId) {
          throw new Error('Invalid list ID');
        }

        const isCreator = listDoc.createdBy === authDetails.cosmosAddress;
        if (!isCreator) {
          throw new Error("Permission error: You don't have permission to update this claim");
        }
      }
    } else {
      const collectionId = Number(context(claim).collectionId);
      if (collectionId > 0) {
        const isManager = await checkIfManager(req, res, collectionId);
        if (!isManager) {
          throw new Error("Permission error: You don't have permission to update this claim");
        }
      }
    }

    // If we have the existing doc, we simply need to update the plugins and keep the state.
    // Else, we need to create a new doc with the plugins and the default state.
    if (existingDoc) {
      const decryptedExistingPlugins = await getDecryptedPluginsAndPublicState(
        req,
        res,
        existingDoc.plugins,
        existingDoc.state,
        true,
        existingDoc.trackerDetails,
        existingDoc.action?.listId
      );

      const decryptedClaimPlugins = await getDecryptedPluginsAndPublicState(
        req,
        res,
        encryptedPlugins,
        existingDoc.state, //Doesnt matter since we check resetState are all false
        true,
        existingDoc.trackerDetails,
        existingDoc.action?.listId
      );

      const isUpdate =
        pluginsWithOptions.some((x) => x.resetState || x.newState) ||
        JSON.stringify(decryptedClaimPlugins) !== JSON.stringify(decryptedExistingPlugins);
      if (!isUpdate) {
        continue;
      }

      //In the case of on-chain collections, we need to check if the user has permission to update the claim (we use the on-chain collection permissions)
      if (claimType == ClaimType.OnChain) {
        const currApprovals = [];
        const updatePermissions = [];
        if (existingDoc.trackerDetails?.approvalLevel === 'collection') {
          const isManager = await checkIfManager(req, res, existingDoc.collectionId);
          if (!isManager) {
            throw new Error("Permission error: You don't have permission to update this claim");
          }
          const collections = await executeCollectionsQuery({} as Request, {} as Response, [{ collectionId: existingDoc.collectionId }]);
          const collection = collections[0];
          currApprovals.push(...collection.collectionApprovals);
          updatePermissions.push(...collection.collectionPermissions.canUpdateCollectionApprovals);
        } else {
          const approverAddress = existingDoc.trackerDetails?.approverAddress;
          if (approverAddress !== authDetails.cosmosAddress) {
            throw new Error("Permission error: You don't have permission to update this claim");
          }

          //TODO: Handle user approvals and permissions (casted to collection)
        }

        const newApprovals = currApprovals.map((x) => {
          if (!existingDoc.trackerDetails) {
            throw new Error('Existing claim does not have tracker details');
          }

          if (existingDoc.trackerDetails.approvalId !== x.approvalId) return x;
          if (existingDoc.trackerDetails.approvalLevel !== 'collection') return x;
          if (existingDoc.trackerDetails.approverAddress !== '') return x;

          if (
            x.approvalCriteria?.merkleChallenges?.some((challenge) => challenge.challengeTrackerId === existingDoc.trackerDetails?.challengeTrackerId)
          ) {
            //We have a match and are updating this approval
            return new CollectionApprovalWithDetails({
              ...x,
              approvalCriteria: {
                ...x.approvalCriteria,
                requireToEqualsInitiatedBy: !x.approvalCriteria?.requireToEqualsInitiatedBy //Just need to change anything to trigger the update check
              }
            });
          }

          return x;
        });
        const err = validateCollectionApprovalsUpdate(currApprovals, newApprovals, updatePermissions);
        if (err) {
          throw new Error("Permission error: You don't have permission to update this claim");
        }
      }

      claimDocsToSet.push({
        ...existingDoc, //Keep all other context
        manualDistribution: context(claim).manualDistribution,
        approach: context(claim).approach,
        action: context(claim).action,
        metadata: context(claim).metadata,
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined,
        lastUpdated: BigInt(Date.now())
      });

      historyDocsToSet.push({
        _docId: crypto.randomBytes(32).toString('hex'),
        updatedAt: Number(Date.now()),
        claimId: existingDoc._docId,
        prevDoc: existingDoc
      });
    } else {
      const currTime = BigInt(Date.now());
      claimDocsToSet.push({
        ...context(claim),
        assignMethod: (claim as CreateClaimRequest<NumberType>).assignMethod,
        _docId: claim.claimId,
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined,
        lastUpdated: currTime,
        createdAt: currTime
      });
    }
  }

  if (claimDocsToSet.length > 0) {
    await insertMany(ClaimBuilderModel, claimDocsToSet, session);
  }

  if (historyDocsToSet.length > 0) {
    await ClaimDocHistoryModel.insertMany(historyDocsToSet, { session });
  }
};

export const deleteOldClaims = async (
  claimType: ClaimType,
  oldClaimQuery: Record<string, any>,
  newClaims: Array<iClaimDetails<NumberType>>,
  session?: mongoose.ClientSession
) => {
  const query = constructQuery(claimType, oldClaimQuery);

  if (claimType === ClaimType.OnChain) {
    throw new Error('On-chain claims cannot be deleted. They are tied to storage on the blockchain.');
  }

  const docsToDelete = await findInDB(ClaimBuilderModel, {
    query: {
      deletedAt: { $exists: false },
      _docId: { $nin: (newClaims ?? []).map((claim) => claim.claimId) },
      ...query
    },
    session
  });

  if (docsToDelete.length > 0) {
    await insertMany(
      ClaimBuilderModel,
      docsToDelete.map((doc) => {
        return {
          ...doc,
          deletedAt: BigInt(Date.now())
        };
      }),
      session
    );
  }
};

export const addBalancesToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddBalancesToOffChainStorageSuccessResponse | ErrorResponse>
) => {
  const reqPayload = req.body as AddBalancesToOffChainStoragePayload;
  const validateRes: typia.IValidation<AddBalancesToOffChainStoragePayload> = typia.validate<AddBalancesToOffChainStoragePayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

  try {
    const origin = req.headers.origin;
    const isFromFrontend = origin === process.env.FRONTEND_URL || origin === 'https://bitbadges.io' || origin === 'https://api.bitbadges.io';
    if (!isFromFrontend) {
      if (reqPayload.claims) {
        if (process.env.TEST_MODE !== 'true') {
          throw new Error('Claims must be managed through other API routes or the frontend, not through here.');
        }
      }

      if (BigInt(reqPayload.collectionId) === 0n) {
        throw new Error('You cannot create for new collections (ID 0) through the API.');
      }

      if (reqPayload.method !== 'centralized') {
        throw new Error('Only centralized method is allowed for non-frontend requests. For IPFS or other methods, please self-host.');
      }
    }

    const authDetails = await mustGetAuthDetails(req, res);
    const customData = crypto.randomBytes(32).toString('hex');
    if (BigInt(reqPayload.collectionId) > 0) {
      const managerCheck = await checkIfManager(req, res, reqPayload.collectionId);
      if (!managerCheck) throw new Error('You are not the manager of this collection');

      const collectionDoc = await mustGetFromDB(CollectionModel, reqPayload.collectionId.toString());
      if (collectionDoc.balancesType !== 'Off-Chain - Indexed' && collectionDoc.balancesType !== 'Off-Chain - Non-Indexed') {
        throw new Error('This collection is not an off-chain collection');
      }
    } else {
      await insertToDB(OffChainUrlModel, {
        _docId: customData,
        createdBy: authDetails.cosmosAddress,
        collectionId: Number(0)
      });
    }

    let urlPath: string | undefined = customData;
    let result;
    let size = 0;
    if (reqPayload.balances) {
      // get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      if (BigInt(reqPayload.collectionId) > 0) {
        // Get existing urlPath
        const collectionDoc = await mustGetFromDB(CollectionModel, reqPayload.collectionId.toString());
        if (collectionDoc.offChainBalancesMetadataTimeline.length > 0) {
          urlPath = collectionDoc.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.split('/').pop() ?? '';
        }
      } else {
        //Little hacky but this ensures the DigitalOceanBalance docs work correctly
        //Explanation: We can't create a DigitalOceanBalance doc without a collectionId, so we just create it upon first balance update
        //             with a collection ID in addBalancesToOffChainStorage(). In the case of claims (which currently is our only use case),
        //             this will be the first completed claim which expects empty balances.
        if (Object.keys(reqPayload.balances).length !== 0 && reqPayload.claims?.length) {
          throw new Error('Genesis collection with claims must start with empty balances');
        }
      }

      const balances = cleanBalanceMap(reqPayload.balances);

      result = await addBalancesToOffChainStorage(balances, reqPayload.method, reqPayload.collectionId, urlPath);
      if (!result) {
        throw new Error('No add result received');
      }

      await updateIpfsTotals(authDetails.cosmosAddress, size);
      if (BigInt(reqPayload.collectionId) > 0) await refreshCollection(reqPayload.collectionId.toString(), true);
    }

    if (reqPayload.claims) {
      if (!reqPayload.collectionId && !result) {
        throw new Error('You must upload the balances to IPFS before adding plugins');
      }

      const cid = urlPath ?? '';
      const claimQuery = { collectionId: Number(reqPayload.collectionId) };
      const isNonIndexed = reqPayload.isNonIndexed;

      await updateClaimDocs(
        req,
        res,
        isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed,
        claimQuery,
        reqPayload.claims ?? [],
        (claim) => {
          return createOffChainClaimContextFunction(authDetails.cosmosAddress, claim, Number(reqPayload.collectionId), cid);
        }
      );
      await deleteOldClaims(isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed, claimQuery, reqPayload.claims ?? []);
    }

    if (!result || !result.uri) {
      return res.status(200).send({});
    } else {
      return res.status(200).send({ uri: result.uri });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error adding balances to storage.'
    });
  }
};

export const addToIpfsHandler = async (req: AuthenticatedRequest<NumberType>, res: Response<iAddToIpfsSuccessResponse | ErrorResponse>) => {
  const reqPayload = req.body as AddToIpfsPayload;
  const validateRes: typia.IValidation<AddToIpfsPayload> = typia.validate<AddToIpfsPayload>(req.body);
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

  try {
    const authDetails = await mustGetAuthDetails(req, res);
    if (!reqPayload.contents) {
      throw new Error('No metadata provided');
    }

    if (reqPayload.contents.length === 0) {
      return res.status(200).send({ results: [] });
    }

    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(authDetails.cosmosAddress, size);

    const metadataToAdd: (iBadgeMetadataDetails<NumberType> | iMetadata<NumberType> | iCollectionMetadataDetails<NumberType>)[] = [];
    const challengeDetailsToAdd: iChallengeDetails<NumberType>[] = [];
    const isMetadata: boolean[] = [];
    for (const content of reqPayload.contents) {
      if ((content as any).leaves) {
        challengeDetailsToAdd.push(content as iChallengeDetails<NumberType>);
        isMetadata.push(false);
      } else {
        metadataToAdd.push(content as iBadgeMetadataDetails<NumberType> | iMetadata<NumberType> | iCollectionMetadataDetails<NumberType>);
        isMetadata.push(true);
      }
    }

    const results = await addMetadataToIpfs(metadataToAdd);
    const challengeResults = await addApprovalDetailsToOffChainStorage(challengeDetailsToAdd);

    //Put them back in order
    const finalResults = [];
    for (let i = 0; i < isMetadata.length; i++) {
      if (isMetadata[i]) {
        finalResults.push(results.shift() ?? { cid: '' });
      } else {
        finalResults.push({ cid: challengeResults?.shift() ?? '' });
      }
    }

    await updateIpfsTotals(authDetails.cosmosAddress, size);

    return res.status(200).send({ results: finalResults });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error adding metadata.'
    });
  }
};

export const addApprovalDetailsToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddApprovalDetailsToOffChainStorageSuccessResponse | ErrorResponse>
) => {
  const _reqPayload = req.body as AddApprovalDetailsToOffChainStoragePayload;
  const validateRes: typia.IValidation<AddApprovalDetailsToOffChainStoragePayload> = typia.validate<AddApprovalDetailsToOffChainStoragePayload>(
    req.body
  );
  if (!validateRes.success) {
    return typiaError(res, validateRes);
  }

  try {
    const authDetails = await mustGetAuthDetails(req, res);
    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(authDetails.cosmosAddress, size);

    const results: iAddApprovalDetailsToOffChainStorageSuccessResponse = {
      approvalResults: []
    };

    for (const reqPayload of _reqPayload.approvalDetails) {
      const challengeDetailsArr = reqPayload.challengeInfoDetails;
      for (const challengeDetailInfo of challengeDetailsArr ?? []) {
        const claims = challengeDetailInfo.claim ? [challengeDetailInfo.claim] : [];
        const challengeDetails = challengeDetailInfo.challengeDetails;
        if (claims && claims?.length > 1) {
          throw new Error('Only one claim can be added at a time for on-chain approvals');
        }

        if (claims) {
          await updateClaimDocs(req, res, ClaimType.OnChain, {}, claims ?? [], (claim) => {
            if (!challengeDetails?.seedCode && !challengeDetails.preimages?.length) {
              throw new Error('Seed code or preimages must be passed for on-chain claim');
            }

            return createOnChainClaimContextFunction(authDetails.cosmosAddress, claim, challengeDetails?.seedCode ?? '');
          });

          // Deleted docs are handled in the poller
        }
      }

      const metadataResults = await addMetadataToIpfs([{ name: reqPayload.name, description: reqPayload.description, image: '' }]);
      const metadataResult = metadataResults[0];

      const challengeResults = await addApprovalDetailsToOffChainStorage(challengeDetailsArr?.map((x) => x.challengeDetails) ?? []);

      results.approvalResults.push({
        metadataResult,
        challengeResults: challengeResults?.map((x) => {
          return { cid: x ?? '' };
        })
      });
    }

    await updateIpfsTotals(authDetails.cosmosAddress, size);

    return res.status(200).send(results);
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: process.env.DEV_MODE === 'true' ? serializeError(e) : undefined,
      errorMessage: e.message || 'Error adding approval details: ' + e.message
    });
  }
};
