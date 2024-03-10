import {
  ClaimBuilderDoc,
  deepCopyPrimitives,
  type AddApprovalDetailsToOffChainStorageRouteRequestBody,
  type AddBalancesToOffChainStorageRouteRequestBody,
  type AddMetadataToIpfsRouteRequestBody,
  type ErrorResponse,
  type NumberType,
  type iAddApprovalDetailsToOffChainStorageRouteSuccessResponse,
  type iAddBalancesToOffChainStorageRouteSuccessResponse,
  type iAddMetadataToIpfsRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { checkIfManager, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { deleteMany, getFromDB, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { ClaimBuilderModel, CollectionModel, IPFSTotalsModel } from '../db/schemas';
import { encryptPlugins, getPlugin } from '../integrations/types';
import { addApprovalDetailsToOffChainStorage, addBalancesToOffChainStorage, addMetadataToIpfs } from '../ipfs/ipfs';
import { cleanBalanceMap } from '../utils/dataCleaners';
import { Plugins } from './claims';
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

export const addBalancesToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddBalancesToOffChainStorageRouteSuccessResponse | ErrorResponse>
) => {
  const reqBody = req.body as AddBalancesToOffChainStorageRouteRequestBody;

  try {
    if (BigInt(reqBody.collectionId) > 0) {
      const managerCheck = await checkIfManager(req, reqBody.collectionId);
      if (!managerCheck) throw new Error('You are not the manager of this collection');
    }

    let result;
    let size = 0;
    if (reqBody.balances) {
      // get size of req.body in KB
      size = Buffer.byteLength(JSON.stringify(req.body));

      let urlPath;

      // I think this is safe assuming we only allow updates to the Digital Ocean spaces from this function
      if (BigInt(reqBody.collectionId) > 0) {
        // Get existing urlPath
        const collectionDoc = await mustGetFromDB(CollectionModel, reqBody.collectionId.toString());
        if (collectionDoc.offChainBalancesMetadataTimeline.length > 0) {
          urlPath = collectionDoc.offChainBalancesMetadataTimeline[0].offChainBalancesMetadata.uri.split('/').pop();
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

    const docsToDelete = await findInDB(ClaimBuilderModel, {
      query: { collectionId: Number(reqBody.collectionId), _docId: { $nin: (reqBody.offChainClaims ?? []).map((claim) => claim.claimId) } }
    });

    for (const claim of reqBody.offChainClaims ?? []) {
      if (!reqBody.collectionId && !result) {
        throw new Error('You must upload the balances to IPFS before adding plugins');
      }

      if (!claim.claimId || !claim.balancesToSet) {
        throw new Error('Invalid claim');
      }

      const query = { collectionId: Number(reqBody.collectionId), docClaimed: true, _docId: claim.claimId };
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
      }

      //If we have the existing doc, we simply need to update the plugins and keep the state.
      //Else, we need to create a new doc with the plugins and the default state.
      if (existingDoc) {
        await insertToDB(ClaimBuilderModel, {
          ...existingDoc,
          action: {
            balancesToSet: claim.balancesToSet
          },
          state,
          plugins: encryptedPlugins ?? []
        });
      } else {
        await insertToDB(
          ClaimBuilderModel,
          new ClaimBuilderDoc({
            _docId: BigInt(reqBody.collectionId) > 0 ? claim.claimId : result?.uri?.split('/').pop() ?? '',
            createdBy: req.session.cosmosAddress,
            collectionId: reqBody.collectionId.toString(),
            docClaimed: BigInt(reqBody.collectionId) > 0,
            cid: BigInt(reqBody.collectionId) > 0 ? claim.claimId : result?.uri?.split('/').pop() ?? '',
            action: {
              balancesToSet: claim.balancesToSet
            },
            state,
            plugins: encryptedPlugins ?? []
          })
        );
      }
    }

    if (docsToDelete.length > 0) {
      await deleteMany(
        ClaimBuilderModel,
        docsToDelete.map((doc) => doc._docId)
      );
    }

    if (!result) {
      return res.status(200).send({ result: { cid: '' } });
    } else {
      return res.status(200).send({ uri: result.uri, result });
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
    const size = Buffer.byteLength(JSON.stringify(req.body));

    await checkIpfsTotals(req.session.cosmosAddress, size);

    const { collectionMetadataResult, badgeMetadataResults } = await addMetadataToIpfs(reqBody.collectionMetadata, reqBody.badgeMetadata);

    if (!collectionMetadataResult && badgeMetadataResults.length === 0) {
      throw new Error('No result received');
    }

    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send({ collectionMetadataResult, badgeMetadataResults });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding metadata. Please try again later.'
    });
  }
};

export const addApprovalDetailsToOffChainStorageHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iAddApprovalDetailsToOffChainStorageRouteSuccessResponse | ErrorResponse>
) => {
  const reqBody = req.body as AddApprovalDetailsToOffChainStorageRouteRequestBody;

  let cid = crypto.randomBytes(32).toString('hex');
  try {
    const challengeDetails = reqBody.challengeDetails;

    const size = Buffer.byteLength(JSON.stringify(req.body));
    await checkIpfsTotals(req.session.cosmosAddress, size);
    const offChainClaims = reqBody.offChainClaims;
    if (offChainClaims && offChainClaims?.length > 1) {
      throw new Error('Only one claim can be added at a time');
    }

    const reqBodyPlugins = encryptPlugins(offChainClaims?.[0].plugins ?? []);
    const result = await addApprovalDetailsToOffChainStorage(reqBody.name, reqBody.description, challengeDetails, reqBodyPlugins);
    if (!result) {
      throw new Error('No IPFS result received');
    }

    cid = result.cid.toString();

    //TODO: Note this does not support any updates or deletes to existing claims.
    // Within the frontend, we do not allow updates to approvals yet, so this is fine for now.
    // Will need to change this if we allow updates to approvals in the future.

    //We handle deletes of old claims in the poller
    for (const claim of offChainClaims ?? []) {
      const encryptedAction = getPlugin('codes').encryptPrivateParams({
        codes: challengeDetails?.leavesDetails.preimages ?? [],
        seedCode: challengeDetails?.leavesDetails.seedCode ?? ''
      });

      const hasSeedCode = challengeDetails?.leavesDetails.seedCode;
      const pluginsWithOptions = deepCopyPrimitives(claim.plugins ?? []);
      const encryptedPlugins = encryptPlugins(claim.plugins ?? []);

      const state: Record<string, any> = {};
      for (const plugin of pluginsWithOptions ?? []) {
        state[plugin.id] = Plugins[plugin.id].defaultState;
        // Note no existing doc state so we don't add it here
      }

      await insertToDB(
        ClaimBuilderModel,
        new ClaimBuilderDoc({
          _docId: cid.toString(),
          createdBy: req.session.cosmosAddress,
          collectionId: '-1',
          docClaimed: false,
          manualDistribution: claim.manualDistribution,
          cid: cid.toString(),
          action: {
            seedCode: hasSeedCode ? encryptedAction.seedCode : undefined,
            codes: hasSeedCode ? undefined : encryptedAction.codes
          },
          state,
          plugins: encryptedPlugins ?? []
        })
      );
    }

    await updateIpfsTotals(req.session.cosmosAddress, size);

    return res.status(200).send({ result: { cid: cid.toString() } });
  } catch (e) {
    console.log(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error adding claim details to IPFS. Please try again later.'
    });
  }
};
