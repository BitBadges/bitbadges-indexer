import {
  CollectionApprovalWithDetails,
  deepCopyPrimitives,
  iClaimBuilderDoc,
  iClaimDetails,
  iPredeterminedBalances,
  validateCollectionApprovalsUpdate,
  type AddApprovalDetailsToOffChainStorageRouteRequestBody,
  type AddBalancesToOffChainStorageRouteRequestBody,
  type AddMetadataToIpfsRouteRequestBody,
  type ClaimIntegrationPluginType,
  type ErrorResponse,
  type IntegrationPluginParams,
  type NumberType,
  type iAddApprovalDetailsToOffChainStorageRouteSuccessResponse,
  type iAddBalancesToOffChainStorageRouteSuccessResponse,
  type iAddMetadataToIpfsRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfManager, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel, CollectionModel, IPFSTotalsModel } from '../db/schemas';
import { encryptPlugins, getPlugin, getPluginParamsAndState } from '../integrations/types';
import { addApprovalDetailsToOffChainStorage, addBalancesToOffChainStorage, addMetadataToIpfs } from '../ipfs/ipfs';
import { cleanBalanceMap } from '../utils/dataCleaners';
import { Plugins } from './claims';
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
  newPlugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>
) => {
  // cant change assignmethods

  const oldNumUses = getPluginParamsAndState('numUses', oldPlugins);
  const newNumUses = getPluginParamsAndState('numUses', newPlugins);

  if (!oldNumUses || !newNumUses) {
    throw new Error('numUses plugin is required');
  }

  // In practice, we could allow firstComeFirstServe -> codeIdx
  // We could also allow codeIdx -> firstComeFirstServe if all codes are linear from 1 (no gaps)
  // But, for simplicity, we will not allow this for now
  if (oldNumUses && newNumUses && oldNumUses.publicParams.assignMethod !== newNumUses.publicParams.assignMethod) {
    throw new Error('Cannot change assignMethod');
  }
};

export enum ClaimType {
  OnChain = 'On-Chain',
  OffChain = 'Off-Chain',
  AddressList = 'Address List'
}

const constructQuery = (claimType: ClaimType, oldClaimQuery: Record<string, any>) => {
  const query: Record<string, any> = {};
  if (claimType === ClaimType.OffChain) {
    query.collectionId = oldClaimQuery.collectionId ?? -10000;
  }

  if (claimType === ClaimType.AddressList) {
    query['action.listId'] = oldClaimQuery['action.listId'] ?? '';
  }

  return query;
};

export const updateClaimDocs = async (
  req: AuthenticatedRequest<NumberType>,
  claimType: ClaimType,
  oldClaimQuery: Record<string, any>,
  newClaims: Array<iClaimDetails<NumberType>>,
  context: (claim: iClaimDetails<NumberType>) => {
    action: { codes?: string[]; seedCode?: string; balancesToSet?: iPredeterminedBalances<NumberType>; listId?: string };
    createdBy: string;
    collectionId: NumberType;
    docClaimed: boolean;
    cid: string;
  }
) => {
  const queryBuilder = constructQuery(claimType, oldClaimQuery);

  const claimDocsToSet: Array<iClaimBuilderDoc<NumberType>> = [];
  for (const claim of newClaims ?? []) {
    if (!claim.claimId) {
      throw new Error('Invalid claim');
    }

    const query = { docClaimed: true, _docId: claim.claimId, ...queryBuilder };
    const existingDocRes = await findInDB(ClaimBuilderModel, { query, limit: 1 });
    const existingDoc = existingDocRes.length > 0 ? existingDocRes[0] : undefined;
    const pluginsWithOptions = deepCopyPrimitives(claim.plugins ?? []);
    const encryptedPlugins = encryptPlugins(claim.plugins ?? []);

    const state: Record<string, any> = {};
    for (const plugin of pluginsWithOptions ?? []) {
      state[plugin.id] = Plugins[plugin.id].defaultState;
      if (existingDoc && !plugin.resetState) {
        state[plugin.id] = existingDoc.state[plugin.id];
      }

      if (claimType == ClaimType.OnChain && plugin.id === 'numUses' && existingDoc && plugin.resetState) {
        throw new Error('numUses plugin is not allowed to be reset for approval claims');
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
        existingDoc.collectionId,
        existingDoc.action?.listId
      );

      const decryptedClaimPlugins = await getDecryptedPluginsAndPublicState(
        req,
        encryptedPlugins,
        existingDoc.state, //Doesnt matter since we check resetState are all false
        true,
        existingDoc.collectionId,
        existingDoc.action?.listId
      );

      const isUpdate =
        pluginsWithOptions.some((x) => x.resetState) || JSON.stringify(decryptedClaimPlugins) !== JSON.stringify(decryptedExistingPlugins);
      if (!isUpdate) {
        continue;
      }

      //In the case of on-chain collections, we need to check if the user has permission to update the claim (we use the on-chain collection permissions)
      if (claimType == ClaimType.OnChain) {
        const collections = await executeCollectionsQuery({} as Request, [{ collectionId: existingDoc.collectionId }]);
        const collection = collections[0];
        const currApprovals = collection.collectionApprovals;
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
        const err = validateCollectionApprovalsUpdate(currApprovals, newApprovals, collection.collectionPermissions.canUpdateCollectionApprovals);
        if (err) {
          throw new Error("Permission error: You don't have permission to update this claim");
        }
      }

      assertPluginsUpdateIsValid(existingDoc.plugins, claim.plugins ?? []);

      claimDocsToSet.push({
        ...existingDoc, //Keep all other context
        action: context(claim).action, //Action can potentially be updated
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined
      });
    } else {
      claimDocsToSet.push({
        ...context(claim),
        _docId: claim.claimId,
        state,
        plugins: encryptedPlugins ?? [],
        deletedAt: undefined
      });
    }
  }

  if (claimDocsToSet.length > 0) {
    await insertMany(ClaimBuilderModel, claimDocsToSet);
  }
};

export const deleteOldClaims = async (claimType: ClaimType, oldClaimQuery: Record<string, any>, newClaims: Array<iClaimDetails<NumberType>>) => {
  const query = constructQuery(claimType, oldClaimQuery);

  const docsToDelete = await findInDB(ClaimBuilderModel, {
    query: {
      deletedAt: { $exists: false },
      _docId: { $nin: (newClaims ?? []).map((claim) => claim.claimId) },
      ...query
    }
  });

  if (docsToDelete.length > 0) {
    await insertMany(
      ClaimBuilderModel,
      docsToDelete.map((doc) => {
        return {
          ...doc,
          deletedAt: BigInt(Date.now())
        };
      })
    );
  }
};

export const addBalancesToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddBalancesToOffChainStorageRouteSuccessResponse | ErrorResponse>
) => {
  const reqBody = req.body as AddBalancesToOffChainStorageRouteRequestBody;

  try {
    if (BigInt(reqBody.collectionId) > 0) {
      const managerCheck = await checkIfManager(req, reqBody.collectionId);
      if (!managerCheck) throw new Error('You are not the manager of this collection');

      const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
      if (collectionDoc.balancesType !== 'Off-Chain - Indexed' && collectionDoc.balancesType !== 'Off-Chain - Non-Indexed') {
        throw new Error('This collection is not an off-chain collection');
      }
    }

    let result;
    let size = 0;
    if (reqBody.balances) {
      // get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      let urlPath;
      if (BigInt(reqBody.collectionId) > 0) {
        // Get existing urlPath
        const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
        if (collectionDoc.offChainBalancesMetadataTimeline.length > 0) {
          urlPath = collectionDoc.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.split('/').pop();
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

      await updateIpfsTotals(req.session.cosmosAddress, size);
      if (BigInt(reqBody.collectionId) > 0) await refreshCollection(reqBody.collectionId.toString(), true);
    }

    if (reqBody.claims) {
      if (!reqBody.collectionId && !result) {
        throw new Error('You must upload the balances to IPFS before adding plugins');
      }

      let cid = result?.uri?.split('/').pop() ?? '';
      if (!result) {
        const collection = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
        const customData = collection.offChainBalancesMetadataTimeline[0]?.offChainBalancesMetadata.customData;
        cid = customData;
      }
      if (!cid) {
        throw new Error('No CID found');
      }

      const claimQuery = { collectionId: Number(reqBody.collectionId) };
      await updateClaimDocs(req, ClaimType.OffChain, claimQuery, reqBody.claims ?? [], (claim) => {
        return {
          action: { balancesToSet: claim.balancesToSet },
          createdBy: req.session.cosmosAddress,
          collectionId: reqBody.collectionId.toString(),
          docClaimed: BigInt(reqBody.collectionId) > 0,
          cid: cid.toString()
        };
      });
      await deleteOldClaims(ClaimType.OffChain, claimQuery, reqBody.claims ?? []);
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
      errorMessage: 'Error adding balances to storage.'
    });
  }
};

export const addMetadataToIpfsHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddMetadataToIpfsRouteSuccessResponse | ErrorResponse>
) => {
  const reqBody = req.body as AddMetadataToIpfsRouteRequestBody;

  try {
    if (!reqBody.metadata) {
      throw new Error('No metadata provided');
    }

    if (reqBody.metadata.length === 0) {
      return res.status(200).send({ results: [] });
    }

    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(req.session.cosmosAddress, size);

    const { results } = await addMetadataToIpfs(reqBody.metadata);
    if (results.length === 0) {
      throw new Error('No result received');
    }

    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send({ results });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding metadata.'
    });
  }
};

export const addApprovalDetailsToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddApprovalDetailsToOffChainStorageRouteSuccessResponse | ErrorResponse>
) => {
  const _reqBody = req.body as AddApprovalDetailsToOffChainStorageRouteRequestBody;

  try {
    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(req.session.cosmosAddress, size);

    const results: iAddApprovalDetailsToOffChainStorageRouteSuccessResponse = {
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
            const encryptedAction = getPlugin('codes').encryptPrivateParams({
              codes: challengeDetails?.preimages ?? [],
              seedCode: challengeDetails?.seedCode ?? ''
            });
            const hasSeedCode = challengeDetails?.seedCode;

            return {
              createdBy: req.session.cosmosAddress,
              collectionId: '-1',
              docClaimed: false,
              manualDistribution: claim.manualDistribution,
              cid: claim.claimId, // challenge tracker ID
              action: {
                seedCode: hasSeedCode ? encryptedAction.seedCode : undefined,
                codes: hasSeedCode ? undefined : encryptedAction.codes
              }
            };
          });

          // Deleted docs are handled in the poller
        }
      }

      const ipfsRes = await addApprovalDetailsToOffChainStorage(
        reqBody.name,
        reqBody.description,
        challengeDetailsArr?.map((x) => x.challengeDetails)
      );

      const result = ipfsRes?.[0];
      const challengeResults = ipfsRes?.[1];

      results.approvalResults.push({
        metadataResult: { cid: result ?? '' },
        challengeResults: challengeResults?.map((x) => {
          return { cid: x ?? '' };
        })
      });
    }

    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send(results);
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding approval details: ' + e.message
    });
  }
};
