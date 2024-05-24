import {
  CollectionApprovalWithDetails,
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
  type AddApprovalDetailsToOffChainStorageBody,
  type AddBalancesToOffChainStorageBody,
  type AddToIpfsBody,
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
import { checkIfManager, mustGetAuthDetails, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AddressListModel, ClaimBuilderModel, CollectionModel, IPFSTotalsModel, OffChainUrlModel } from '../db/schemas';
import { encryptPlugins, getFirstMatchForPluginType, getPlugin } from '../integrations/types';
import { addApprovalDetailsToOffChainStorage, addBalancesToOffChainStorage, addMetadataToIpfs } from '../ipfs/ipfs';
import { cleanBalanceMap } from '../utils/dataCleaners';
import { Plugins, createOffChainClaimContextFunction, createOnChainClaimContextFunction } from './claims';
import { executeCollectionsQuery, getDecryptedPluginsAndPublicState } from './collections';
import { refreshCollection } from './refresh';

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

export const assertPluginsUpdateIsValid = (
  oldPlugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  newPlugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>,
  isNonIndexed?: boolean
) => {
  // cant change assignmethods

  const oldNumUses = getFirstMatchForPluginType('numUses', oldPlugins);
  const newNumUses = getFirstMatchForPluginType('numUses', newPlugins);

  if (!newNumUses && !isNonIndexed) {
    throw new Error('numUses plugin is required');
  }

  // In practice, we could allow firstComeFirstServe -> codeIdx
  // We could also allow codeIdx -> firstComeFirstServe if all codes are linear from 1 (no gaps)
  // But, for simplicity, we will not allow this for now
  if (oldNumUses && newNumUses && oldNumUses.publicParams.assignMethod !== newNumUses.publicParams.assignMethod) {
    throw new Error('Cannot change assignMethod');
  }

  //Assert no duplicate IDs
  for (const plugin of newPlugins) {
    if (newPlugins.filter((x) => x.id === plugin.id).length > 1) {
      throw new Error('Duplicate plugin IDs are not allowed');
    }
  }

  //Assert plugin IDs are alphanumeric
  for (const plugin of newPlugins) {
    if (!/^[a-zA-Z0-9]*$/.test(plugin.id)) {
      throw new Error('Plugin IDs must be alphanumeric');
    }
  }

  for (const plugin of Object.entries(Plugins)) {
    let duplicatesAllowed = plugin[1].metadata.duplicatesAllowed;
    if (newNumUses?.publicParams.assignMethod === 'codeIdx' && plugin[0] === 'codes') {
      duplicatesAllowed = false;
    }

    if (duplicatesAllowed) continue;

    if (newPlugins.filter((x) => x.type === plugin[0]).length > 1) {
      throw new Error('Duplicate plugins are not allowed for type: ' + plugin[0]);
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
    query.collectionId = oldClaimQuery.collectionId ?? -10000;
  }

  if (claimType === ClaimType.AddressList) {
    query['action.listId'] = oldClaimQuery['action.listId'] ?? '';
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
  automatic?: boolean;
  createdBy: string;
  collectionId: NumberType;
  docClaimed: boolean;
  cid: string;
  manualDistribution?: boolean;
  trackerDetails?: iChallengeTrackerIdDetails<NumberType>;
}

export const updateClaimDocs = async (
  req: AuthenticatedRequest<NumberType>,
  claimType: ClaimType,
  oldClaimQuery: Record<string, any>,
  newClaims: Array<iClaimDetails<NumberType>>,
  context: (claim: iClaimDetails<NumberType>) => ContextReturn,
  session?: mongoose.ClientSession,
  isCreation?: boolean
) => {
  const queryBuilder = constructQuery(claimType, oldClaimQuery);
  const authDetails = await mustGetAuthDetails(req);

  const claimDocsToSet: Array<iClaimBuilderDoc<NumberType>> = [];
  for (const claim of newClaims ?? []) {
    if (!claim.claimId) {
      throw new Error('Invalid claim');
    }

    const query = { docClaimed: true, _docId: claim.claimId, ...queryBuilder };
    const existingDocRes = await findInDB(ClaimBuilderModel, { query, limit: 1, session });
    const existingDoc = existingDocRes.length > 0 ? existingDocRes[0] : undefined;
    const pluginsWithOptions = deepCopyPrimitives(claim.plugins ?? []);
    const encryptedPlugins = await encryptPlugins(claim.plugins ?? []);

    const state: Record<string, any> = {};
    for (const plugin of pluginsWithOptions ?? []) {
      const pluginObj = await getPlugin(plugin.type);
      state[plugin.id] = existingDoc?.state[plugin.id] ?? pluginObj.defaultState;
      if (plugin.resetState) {
        state[plugin.id] = pluginObj.defaultState;
      } else if (plugin.newState) {
        state[plugin.id] = plugin.newState;
      }

      if (plugin.resetState && plugin.newState) {
        throw new Error('Cannot set both resetState and newState');
      }

      if (claimType == ClaimType.OnChain && plugin.type === 'numUses' && existingDoc && plugin.resetState) {
        throw new Error('numUses plugin is not allowed to be reset for approval claims');
      }
    }

    const isNonIndexed = claimType === ClaimType.OffChainNonIndexed;
    assertPluginsUpdateIsValid(existingDoc?.plugins ?? [], claim.plugins ?? [], isNonIndexed);

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
        const isManager = await checkIfManager(req, collectionId);
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
        existingDoc.plugins,
        existingDoc.state,
        true,
        existingDoc.trackerDetails,
        existingDoc.action?.listId
      );

      const decryptedClaimPlugins = await getDecryptedPluginsAndPublicState(
        req,
        encryptedPlugins,
        existingDoc.state, //Doesnt matter since we check resetState are all false
        true,
        existingDoc.trackerDetails,
        existingDoc.action?.listId
      );

      const isUpdate =
        pluginsWithOptions.some((x) => x.resetState) || JSON.stringify(decryptedClaimPlugins) !== JSON.stringify(decryptedExistingPlugins);
      if (!isUpdate) {
        continue;
      }

      //In the case of on-chain collections, we need to check if the user has permission to update the claim (we use the on-chain collection permissions)
      if (claimType == ClaimType.OnChain) {
        const currApprovals = [];
        const updatePermissions = [];
        if (existingDoc.trackerDetails?.approvalLevel === 'collection') {
          const isManager = await checkIfManager(req, existingDoc.collectionId);
          if (!isManager) {
            throw new Error("Permission error: You don't have permission to update this claim");
          }
          const collections = await executeCollectionsQuery({} as Request, [{ collectionId: existingDoc.collectionId }]);
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
        automatic: context(claim).automatic,
        action: context(claim).action,
        metadata: context(claim).metadata,
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined,
        lastUpdated: BigInt(Date.now())
      });
    } else {
      claimDocsToSet.push({
        ...context(claim),
        _docId: claim.claimId,
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined,
        lastUpdated: BigInt(Date.now())
      });
    }
  }

  if (claimDocsToSet.length > 0) {
    await insertMany(ClaimBuilderModel, claimDocsToSet, session);
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
  const reqBody = req.body as AddBalancesToOffChainStorageBody;

  try {
    const authDetails = await mustGetAuthDetails(req);
    const customData = crypto.randomBytes(32).toString('hex');
    if (BigInt(reqBody.collectionId) > 0) {
      const managerCheck = await checkIfManager(req, reqBody.collectionId);
      if (!managerCheck) throw new Error('You are not the manager of this collection');

      const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
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
    if (reqBody.balances) {
      // get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      if (BigInt(reqBody.collectionId) > 0) {
        // Get existing urlPath
        const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
        if (collectionDoc.offChainBalancesMetadataTimeline.length > 0) {
          urlPath = collectionDoc.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.split('/').pop() ?? '';
        }
      } else {
        //Little hacky but this ensures the DigitalOceanBalance docs work correctly
        //Explanation: We can't create a DigitalOceanBalance doc without a collectionId, so we just create it upon first balance update
        //             with a collection ID in addBalancesToOffChainStorage(). In the case of claims (which currently is our only use case),
        //             this will be the first completed claim which expects empty balances.
        if (Object.keys(reqBody.balances).length !== 0 && reqBody.claims?.length) {
          throw new Error('Genesis collection with claims must start with empty balances');
        }
      }

      const balances = cleanBalanceMap(reqBody.balances);
      result = await addBalancesToOffChainStorage(balances, reqBody.method, reqBody.collectionId, urlPath);
      if (!result) {
        throw new Error('No add result received');
      }

      await updateIpfsTotals(authDetails.cosmosAddress, size);
      if (BigInt(reqBody.collectionId) > 0) await refreshCollection(reqBody.collectionId.toString(), true);
    }

    if (reqBody.claims) {
      if (!reqBody.collectionId && !result) {
        throw new Error('You must upload the balances to IPFS before adding plugins');
      }

      const cid = urlPath ?? '';
      const claimQuery = { collectionId: Number(reqBody.collectionId) };
      const isNonIndexed = reqBody.isNonIndexed;

      await updateClaimDocs(
        req,
        isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed,
        claimQuery,
        reqBody.claims ?? [],
        (claim) => {
          return createOffChainClaimContextFunction(authDetails.cosmosAddress, claim, Number(reqBody.collectionId), cid);
        }
      );
      await deleteOldClaims(isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed, claimQuery, reqBody.claims ?? []);
    }

    if (!result || !result.uri) {
      return res.status(200).send({});
    } else {
      return res.status(200).send({ uri: result.uri });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message || 'Error adding balances to storage.'
    });
  }
};

export const addToIpfsHandler = async (req: AuthenticatedRequest<NumberType>, res: Response<iAddToIpfsSuccessResponse | ErrorResponse>) => {
  const reqBody = req.body as AddToIpfsBody;

  try {
    const authDetails = await mustGetAuthDetails(req);
    if (!reqBody.contents) {
      throw new Error('No metadata provided');
    }

    if (reqBody.contents.length === 0) {
      return res.status(200).send({ results: [] });
    }

    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(authDetails.cosmosAddress, size);

    const metadataToAdd: (iBadgeMetadataDetails<NumberType> | iMetadata<NumberType> | iCollectionMetadataDetails<NumberType>)[] = [];
    const challengeDetailsToAdd: iChallengeDetails<NumberType>[] = [];
    const isMetadata: boolean[] = [];
    for (const content of reqBody.contents) {
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
      error: serializeError(e),
      errorMessage: e.message || 'Error adding metadata.'
    });
  }
};

export const addApprovalDetailsToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddApprovalDetailsToOffChainStorageSuccessResponse | ErrorResponse>
) => {
  const _reqBody = req.body as AddApprovalDetailsToOffChainStorageBody;

  try {
    const authDetails = await mustGetAuthDetails(req);
    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(authDetails.cosmosAddress, size);

    const results: iAddApprovalDetailsToOffChainStorageSuccessResponse = {
      approvalResults: []
    };

    for (const reqBody of _reqBody.approvalDetails) {
      const challengeDetailsArr = reqBody.challengeInfoDetails;
      for (const challengeDetailInfo of challengeDetailsArr ?? []) {
        const claims = challengeDetailInfo.claim ? [challengeDetailInfo.claim] : [];
        const challengeDetails = challengeDetailInfo.challengeDetails;
        if (claims && claims?.length > 1) {
          throw new Error('Only one claim can be added at a time for on-chain approvals');
        }

        if (claims) {
          await updateClaimDocs(req, ClaimType.OnChain, {}, claims ?? [], (claim) => {
            if (!challengeDetails?.seedCode && !challengeDetails.preimages?.length) {
              throw new Error('Seed code or preimages must be passed for on-chain claim');
            }

            return createOnChainClaimContextFunction(authDetails.cosmosAddress, claim, challengeDetails?.seedCode ?? '');
          });

          // Deleted docs are handled in the poller
        }
      }

      const metadataResults = await addMetadataToIpfs([{ name: reqBody.name, description: reqBody.description, image: '' }]);
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
      error: serializeError(e),
      errorMessage: e.message || 'Error adding approval details: ' + e.message
    });
  }
};
