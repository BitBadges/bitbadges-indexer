import {
  BalanceArray,
  BigIntify,
  ClaimBuilderDoc,
  CosmosAddress,
  CreateClaimBody,
  UpdateClaimBody,
  convertToCosmosAddress,
  iClaimBuilderDoc,
  iClaimDetails,
  iCreateClaimSuccessResponse,
  iGetClaimAttemptStatusSuccessResponse,
  iGetReservedCodesSuccessResponse,
  iQueueDoc,
  iSimulateClaimSuccessResponse,
  iUpdateClaimSuccessResponse,
  mustConvertToCosmosAddress,
  type ClaimIntegrationPluginType,
  type ErrorResponse,
  type GetClaimsBody,
  type ListActivityDoc,
  type NumberType,
  type iCompleteClaimSuccessResponse,
  type iGetClaimsSuccessResponse
} from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { type Response } from 'express';
import { ClientSession } from 'mongoose';
import { serializeError } from 'serialize-error';
import {
  BlockinSession,
  MaybeAuthenticatedRequest,
  checkIfAuthenticated,
  checkIfManager,
  setMockSessionIfTestMode,
  type AuthenticatedRequest
} from '../blockin/blockin_handlers';
import { MongoDB, getFromDB, insertMany, insertToDB, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import validator from 'validator';
import {
  AddressListModel,
  ClaimAttemptStatusModel,
  ClaimBuilderModel,
  CollectionModel,
  DigitalOceanBalancesModel,
  ListActivityModel,
  PluginModel,
  ProfileModel,
  QueueModel
} from '../db/schemas';
import { getStatus } from '../db/status';
import { DiscordPluginDetails, GitHubPluginDetails, GooglePluginDetails, TwitterPluginDetails } from '../integrations/auth';
import { CodesPluginDetails, generateCodesFromSeed } from '../integrations/codes';
import { NumUsesDetails } from '../integrations/numUses';
import { PasswordPluginDetails } from '../integrations/passwords';
import { RequiresSignaturePluginDetails } from '../integrations/signature';
import { TransferTimesPluginDetails } from '../integrations/transferTimes';
import { getCorePlugin, getFirstMatchForPluginType, getPlugin, type BackendIntegrationPlugin, type ContextInfo } from '../integrations/types';
import { WhitelistPluginDetails } from '../integrations/whitelist';
import { addBalancesToOffChainStorage } from '../ipfs/ipfs';
import { getActivityDocsForListUpdate } from './addressLists';
import { getClaimDetailsForFrontend } from './collections';
import { ClaimType, ContextReturn, updateClaimDocs } from './ipfs';
import { refreshCollection } from './refresh';

export const Plugins: { [key in ClaimIntegrationPluginType]: BackendIntegrationPlugin<key> } = {
  codes: CodesPluginDetails,
  password: PasswordPluginDetails,
  numUses: NumUsesDetails,
  transferTimes: TransferTimesPluginDetails,
  initiatedBy: RequiresSignaturePluginDetails,
  whitelist: WhitelistPluginDetails,
  github: GitHubPluginDetails,
  google: GooglePluginDetails,
  // email: EmailPluginDetails,
  twitter: TwitterPluginDetails,
  discord: DiscordPluginDetails
};

enum ActionType {
  Code = 'Code',
  SetBalance = 'SetBalance',
  AddToList = 'AddToList',
  ClaimNumbers = 'ClaimNumbers'
}

//Wrappers so we don't have to repeat the context functions

export const createListClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  listId: string
): ContextReturn => {
  return {
    metadata: claim.metadata,
    automatic: claim.automatic,
    createdBy: req.session.cosmosAddress,
    action: { listId: listId },
    collectionId: '-1',
    docClaimed: true,
    cid: ''
  };
};

export const createOffChainClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  collectionId: number,
  cid: string
): ContextReturn => {
  return {
    action: { balancesToSet: claim.balancesToSet },
    automatic: claim.automatic,
    metadata: claim.metadata,
    createdBy: req.session.cosmosAddress,
    collectionId: collectionId,
    docClaimed: collectionId > 0,
    trackerDetails: {
      approvalId: '',
      approvalLevel: 'collection',
      approverAddress: '',
      collectionId: 0,
      challengeTrackerId: cid
    },
    cid: cid
  };
};

export const createOnChainClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  seedCode: string
): ContextReturn => {
  const encryptedAction = getCorePlugin('codes').encryptPrivateParams({
    codes: [],
    seedCode: seedCode ?? ''
  });

  return {
    automatic: claim.automatic,
    metadata: claim.metadata,
    createdBy: req.session.cosmosAddress,
    collectionId: '-1',
    docClaimed: false,
    manualDistribution: claim.manualDistribution,
    cid: claim.claimId,
    action: {
      seedCode: encryptedAction.seedCode
    }
  };
};

export const updateListClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  claimDoc: ClaimBuilderDoc<NumberType>
): ContextReturn => {
  return {
    metadata: claim.metadata,
    automatic: claim.automatic,
    createdBy: claimDoc.createdBy,
    action: claimDoc.action,
    collectionId: '-1',
    docClaimed: true,
    cid: ''
  };
};

export const updateOffChainClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  claimDoc: ClaimBuilderDoc<NumberType>
): ContextReturn => {
  return {
    action: { balancesToSet: claim.balancesToSet },
    automatic: claim.automatic,
    metadata: claim.metadata,
    createdBy: claimDoc.createdBy,
    collectionId: claimDoc.collectionId,
    docClaimed: claimDoc.docClaimed,
    trackerDetails: claimDoc.trackerDetails,
    cid: claimDoc.cid
  };
};

export const updateOnChainClaimContextFunction = (
  req: AuthenticatedRequest<NumberType>,
  claim: iClaimDetails<NumberType>,
  claimDoc: ClaimBuilderDoc<NumberType>
): ContextReturn => {
  return {
    automatic: claim.automatic,
    metadata: claim.metadata,
    createdBy: claimDoc.createdBy,
    collectionId: claimDoc.collectionId,
    docClaimed: claimDoc.docClaimed,
    manualDistribution: claim.manualDistribution,
    cid: claimDoc.cid,
    action: claimDoc.action
  };
};

//TODO: Sessionize / parallelize these

export const createClaimHandler = async (req: AuthenticatedRequest<NumberType>, res: Response<iCreateClaimSuccessResponse | ErrorResponse>) => {
  try {
    const body = req.body as CreateClaimBody<NumberType>;
    const { claims } = body;
    for (const claim of claims) {
      const { listId, collectionId: collId, seedCode } = claim;
      const collectionId = Number(collId) > 0 ? collId : undefined;
      const collectionDoc = collectionId ? await mustGetFromDB(CollectionModel, collectionId.toString()) : undefined;
      const isOnChain = collectionDoc?.balancesType === 'Standard';

      //For claiming process, make sure you use same address as creator for both claim and transaction
      //Options:
      //  1. Specify listId to create a claim for that address list
      //  2. Specify claimId === challengeTrackerId for on-chain (will claim once we index it)
      //  3. For off-chain, if pre collection creation, specify collectionId === 0 and cid === balances route (note will only claim once)
      //  4. For off-chain, if post collection creation, specify collectionId and we check manager

      if (listId) {
        const query = { 'action.listId': listId };
        await updateClaimDocs(req, ClaimType.AddressList, query, [claim], (claim) => {
          return createListClaimContextFunction(req, claim, listId);
        });
      } else if (collectionId && collectionDoc && !isOnChain) {
        const claimQuery = { collectionId: Number(collectionId) };
        const cid = claim.cid ?? '';
        const passedInCollectionId = Number(claim.collectionId) ?? 0;
        if (passedInCollectionId > 0) {
          const isManager = await checkIfManager(req, passedInCollectionId.toString());
          if (!isManager) {
            throw new Error('Not authorized to update this claim. Must be manager');
          }
        }

        const isNonIndexed = collectionDoc.balancesType === 'Off-Chain - Non-Indexed';
        await updateClaimDocs(req, isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed, claimQuery, [claim], (claim) => {
          return createOffChainClaimContextFunction(req, claim, passedInCollectionId, cid);
        });
      } else if (collectionId && collectionDoc && isOnChain) {
        await updateClaimDocs(req, ClaimType.OnChain, {}, [claim], (claim) => {
          if (!seedCode) {
            throw new Error('Seed code required for on-chain claims');
          }

          return createOnChainClaimContextFunction(req, claim, seedCode);
        });
      }
    }

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const updateClaimHandler = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateClaimSuccessResponse | ErrorResponse>) => {
  try {
    const body = req.body as UpdateClaimBody<NumberType>;
    const { claims } = body;
    for (const claim of claims) {
      const claimDoc = await mustGetFromDB(ClaimBuilderModel, claim.claimId);
      if (!claimDoc.docClaimed) {
        throw new Error('Claim not yet claimed');
      }

      const listId = claimDoc.action.listId;
      const collectionId = Number(claimDoc.collectionId) > 0 ? claimDoc.collectionId : undefined;
      const collectionDoc = collectionId ? await mustGetFromDB(CollectionModel, collectionId.toString()) : undefined;
      const isOnChain = collectionDoc?.balancesType === 'Standard';

      if (listId) {
        const query = { 'action.listId': listId };
        await updateClaimDocs(req, ClaimType.AddressList, query, [claim], (claim) => {
          return updateListClaimContextFunction(req, claim, claimDoc);
        });
      } else if (collectionId && collectionDoc && !isOnChain) {
        const claimQuery = { collectionId: Number(collectionId) };
        const isNonIndexed = collectionDoc.balancesType === 'Off-Chain - Non-Indexed';
        await updateClaimDocs(req, isNonIndexed ? ClaimType.OffChainNonIndexed : ClaimType.OffChainIndexed, claimQuery, [claim], (claim) => {
          return updateOffChainClaimContextFunction(req, claim, claimDoc);
        });
      } else if (collectionId && collectionDoc && isOnChain) {
        await updateClaimDocs(req, ClaimType.OnChain, {}, [claim], (claim) => {
          return updateOnChainClaimContextFunction(req, claim, claimDoc);
        });
      }
    }

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const deleteClaimHandler = async (req: AuthenticatedRequest<NumberType>, res: Response<iUpdateClaimSuccessResponse | ErrorResponse>) => {
  try {
    const docsToDelete = [];
    for (const claimId of req.body.claimIds) {
      const doc = await mustGetFromDB(ClaimBuilderModel, claimId);

      if (doc.action.listId) {
        const listDoc = await mustGetFromDB(AddressListModel, doc.action.listId);
        const isCreator = req.session.cosmosAddress === listDoc.createdBy;
        if (!isCreator) {
          throw new Error('Not authorized to delete this claim.');
        }
      } else {
        const isManager = await checkIfManager(req, doc.collectionId.toString());
        if (!isManager) {
          throw new Error('Not authorized to delete this claim.');
        }
      }

      docsToDelete.push(doc);
    }

    await insertMany(
      ClaimBuilderModel,
      docsToDelete.map((doc) => {
        return {
          ...doc,
          deletedAt: BigInt(Date.now())
        };
      })
    );

    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const getClaimsHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimsSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqBody = req.body as GetClaimsBody;
    const query = { docClaimed: true, _docId: { $in: reqBody.claimIds }, deletedAt: { $exists: false } };
    const docs = await findInDB(ClaimBuilderModel, { query });

    const claims = await getClaimDetailsForFrontend(req, docs);

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      const doc = docs.find((x) => x._docId === claim.claimId);
      if (!doc) {
        throw new Error('No doc found');
      }

      if (doc.action.listId) {
        // We need to check if they are for a private / viewable with link only list
        // If so, we have to return blank public state unless they can prove they have permissions
        const addressListDoc = await mustGetFromDB(AddressListModel, doc.action.listId);
        let hasPermissions = !(addressListDoc.private || addressListDoc.viewableWithLink);
        if (addressListDoc.private) {
          hasPermissions = hasPermissions || req.session.cosmosAddress === addressListDoc.createdBy;
        }

        // Prove knowledge of list link by specifying listId
        if (addressListDoc.viewableWithLink) {
          hasPermissions = hasPermissions || reqBody.listId === addressListDoc._docId;
        }

        if (!hasPermissions) {
          for (const plugin of claim.plugins) {
            const pluginObj = await getPlugin(plugin.type);
            plugin.publicState = pluginObj.getBlankPublicState();
          }
        }
      }
    }
    return res.status(200).send({ claims });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting claims. ' + e.message
    });
  }
};

export const completeClaimHandler = async (
  req: { session: BlockinSession<NumberType>; body: any },
  claimId: string,
  cosmosAddress: CosmosAddress,
  simulate = false,
  prevCodesOnly = false
): Promise<iGetReservedCodesSuccessResponse> => {
  const query = { _docId: claimId, docClaimed: true, deletedAt: { $exists: false } };

  cosmosAddress = mustConvertToCosmosAddress(cosmosAddress);
  const context: ContextInfo = Object.freeze({
    cosmosAddress,
    claimId
  });

  const useSession = !simulate && !prevCodesOnly;
  let response = {};
  const session = useSession ? await MongoDB.startSession() : undefined;
  if (session) session.startTransaction();
  try {
    const claimBuilderDocResponse = await findInDB(ClaimBuilderModel, { query, limit: 1, session });
    if (claimBuilderDocResponse.length === 0) {
      throw new Error('No doc found');
    }

    const claimBuilderDoc = claimBuilderDocResponse[0];
    if (claimBuilderDoc.manualDistribution) {
      throw new Error('This claim is for manual distribution only. BitBadges does not handle any distribution for this claim.');
    }

    let actionType = ActionType.ClaimNumbers;
    if (claimBuilderDoc.action.codes?.length || claimBuilderDoc.action.seedCode) {
      actionType = ActionType.Code;
    } else if (claimBuilderDoc.action.balancesToSet) {
      actionType = ActionType.SetBalance;
    } else if (claimBuilderDoc.action.listId) {
      actionType = ActionType.AddToList;
    }

    if (!getFirstMatchForPluginType('numUses', claimBuilderDoc.plugins)) {
      throw new Error('No numUses plugin found');
    }

    if (getFirstMatchForPluginType('initiatedBy', claimBuilderDoc.plugins)) {
      if (!checkIfAuthenticated(req as MaybeAuthenticatedRequest<NumberType>, ['Complete Claims'])) {
        throw new Error('Authentication required with the Complete Claims scope');
      }
    }

    const numUsesPluginId = getFirstMatchForPluginType('numUses', claimBuilderDoc.plugins)?.id;

    if (actionType === ActionType.Code && prevCodesOnly) {
      const prevUsedIdxs = claimBuilderDoc.state[`${numUsesPluginId}`].claimedUsers[context.cosmosAddress] ?? [];

      if (prevUsedIdxs !== undefined) {
        const codes = getDecryptedActionCodes(claimBuilderDoc);
        return {
          prevCodes: prevUsedIdxs.map((idx: number) => codes[Number(idx)])
        };
      }
    } else if (prevCodesOnly) {
      throw new Error('Invalid configuration. Reserved codes can only be fetched for on-chain claims.');
    }

    // Pass in email only if previously set up and verified
    // Must be logged in
    let email = '';
    const results = [];
    for (const plugin of claimBuilderDoc.plugins) {
      const pluginInstance = await getPlugin(plugin.type);
      const pluginDoc = await getFromDB(PluginModel, plugin.id, session);

      let adminInfo: any = {};

      const requiresEmail = pluginDoc?.verificationCall?.passEmail;

      if (req.session.cosmosAddress && requiresEmail && !email) {
        const profileDoc = await mustGetFromDB(ProfileModel, req.session.cosmosAddress, session);
        if (!profileDoc) {
          throw new Error('Email required but no profile found');
        }

        if (profileDoc.notifications?.email) {
          if (profileDoc.notifications.emailVerification?.verified) {
            email = profileDoc.notifications.email;
          }
        }

        if (!email) {
          throw new Error('Email required but none found in profile');
        }
      } else {
        if (requiresEmail) {
          throw new Error('Email required but user is not logged in to BitBadges');
        }
      }

      if (pluginDoc) {
        adminInfo = {
          discord: req.session.discord,
          twitter: req.session.twitter,
          github: req.session.github,
          google: req.session.google,
          email
        };
      }

      switch (plugin.type) {
        case 'initiatedBy':
          adminInfo = req.session;
          break;
        case 'discord':
          adminInfo = req.session.discord;
          break;
        case 'twitter':
          adminInfo = req.session.twitter;
          break;
        case 'codes': {
          adminInfo = {
            assignMethod: getFirstMatchForPluginType('numUses', claimBuilderDoc.plugins)?.publicParams.assignMethod,
            numUsesPluginId: getFirstMatchForPluginType('numUses', claimBuilderDoc.plugins)?.id
          };
          break;
        }
        case 'github':
          adminInfo = req.session.github;
          break;
        case 'google':
          adminInfo = req.session.google;
          break;
        case 'email':
          adminInfo = {
            username: email,
            id: email
          };
          break;
        default:
          break;
      }

      const result = await pluginInstance.validateFunction(
        { ...context, pluginId: plugin.id, pluginType: plugin.type },
        Object.freeze(plugin.publicParams),
        Object.freeze(pluginInstance.decryptPrivateParams(plugin.privateParams)),
        req.body[plugin.id],
        pluginInstance.metadata.stateless ? undefined : claimBuilderDoc.state[plugin.id],
        pluginInstance.metadata.scoped ? undefined : Object.freeze(claimBuilderDoc.state),
        adminInfo
      );

      results.push(result);

      if (!result.success) {
        throw new Error('One or more of the challenges were not satisfied. ' + result.error);
      }
    }

    if (simulate) {
      return {};
    }

    const setters = results
      .map((result) => result.toSet)
      .filter((x) => x)
      .flat();

    // Find the doc, increment currCode, and add the given code idx to claimedUsers
    const newDoc = await ClaimBuilderModel.findOneAndUpdate(
      {
        ...query,
        _docId: claimBuilderDoc._docId
      },
      setters,
      { new: true, session }
    )
      .lean()
      .exec();
    if (!newDoc) {
      throw new Error('No doc found');
    }

    //Past the point where it could be undefined (simulate or prevCodesOnly)
    const castedSession = session as ClientSession;

    // Perform Actions
    if (actionType === ActionType.SetBalance) {
      await performBalanceClaimAction(newDoc as ClaimBuilderDoc<NumberType>, castedSession);
    } else if (actionType === ActionType.Code) {
      const currCodeIdx = newDoc.state[`${numUsesPluginId}`].claimedUsers[context.cosmosAddress].pop();
      const code = distributeCodeAction(newDoc as ClaimBuilderDoc<NumberType>, currCodeIdx);
      const prevUsedCodes = newDoc.state[`${numUsesPluginId}`].claimedUsers[context.cosmosAddress].slice(0, -1);

      response = { prevCodes: prevUsedCodes.map((idx: number) => distributeCodeAction(newDoc as ClaimBuilderDoc<NumberType>, idx)), code };
    } else if (actionType === ActionType.AddToList && claimBuilderDoc.action.listId) {
      await addToAddressListAction(newDoc as ClaimBuilderDoc<NumberType>, context.cosmosAddress, castedSession);
    } else if (actionType === ActionType.ClaimNumbers) {
    } else {
      throw new Error('No action found');
    }
    await castedSession.commitTransaction();
  } catch (e) {
    if (session) await session.abortTransaction();
    throw e;
  } finally {
    if (session) await session.endSession();
  }

  return response;
};

export const simulateClaim = async (req: AuthenticatedRequest<NumberType>, res: Response<iSimulateClaimSuccessResponse | ErrorResponse>) => {
  try {
    setMockSessionIfTestMode(req);

    const claimId = req.params.claimId;

    if (!validator.isHexadecimal(claimId)) {
      throw new Error('Invalid claimId format');
    }

    const simulate = true;
    const cosmosAddress = mustConvertToCosmosAddress(req.params.cosmosAddress);

    await completeClaimHandler(req, claimId, cosmosAddress, simulate);
    return res.status(200).send();
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const getReservedCodes = async (req: AuthenticatedRequest<NumberType>, res: Response<iGetReservedCodesSuccessResponse | ErrorResponse>) => {
  try {
    setMockSessionIfTestMode(req);

    if (!checkIfAuthenticated(req, ['Full Access'])) {
      throw new Error('Unauthorized');
    }

    const claimId = req.params.claimId;
    const cosmosAddress = mustConvertToCosmosAddress(req.params.cosmosAddress);
    const response = await completeClaimHandler(req, claimId, cosmosAddress, true, true);
    return res.status(200).send(response);
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const getClaimsStatusHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimAttemptStatusSuccessResponse | ErrorResponse>
) => {
  try {
    const txId = req.params.txId;

    // Validate txId
    if (!validator.isHexadecimal(txId)) {
      throw new Error('Invalid txId format');
    }

    const doc = await ClaimAttemptStatusModel.findOne({ _docId: txId });
    if (!doc) {
      throw new Error('No doc found');
    }

    // Reserved codes reserve the right to initiate an on-chain transaction.
    // To initiate a transaction, a signature is required.
    // We only return the reserved codes if the user is authenticated as themselves.
    if (checkIfAuthenticated(req, ['Full Access'])) {
      return res.status(200).json({ success: doc.success ?? false, error: doc?.error, code: doc?.code });
    } else {
      return res.status(200).json({ success: doc.success ?? false, error: doc?.error });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const completeClaim = async (req: AuthenticatedRequest<NumberType>, res: Response<iCompleteClaimSuccessResponse | ErrorResponse>) => {
  try {
    setMockSessionIfTestMode(req);

    //Simulate and return an error immediately if not valid
    const claimId = req.params.claimId;
    const cosmosAddress = mustConvertToCosmosAddress(req.params.cosmosAddress);
    await completeClaimHandler(req, claimId, cosmosAddress, true);

    const randomId = crypto.randomBytes(32).toString('hex');
    const newQueueDoc: iQueueDoc<bigint> = {
      _docId: randomId,
      notificationType: 'claim',

      collectionId: 0n,
      uri: '',
      loadBalanceId: 0n,

      refreshRequestTime: BigInt(Date.now()),
      numRetries: 0n,
      claimInfo: {
        claimId: claimId,
        cosmosAddress: cosmosAddress,
        session: JSON.parse(
          JSON.stringify({
            cosmosAddress: req.session.cosmosAddress,
            discord: req.session.discord
              ? {
                  id: req.session.discord?.id,
                  username: req.session.discord?.username,
                  discriminator: req.session.discord?.discriminator
                }
              : undefined,
            twitter: req.session.twitter ? { id: req.session.twitter?.id, username: req.session.twitter?.username } : undefined,
            github: req.session.github ? { id: req.session.github?.id, username: req.session.github?.username } : undefined,
            google: req.session.google ? { id: req.session.google?.id, username: req.session.google?.username } : undefined,
            blockin: req.session.blockin,
            blockinParams: req.session.blockinParams,
            address: req.session.address
          })
        ),
        body: JSON.parse(JSON.stringify(req.body))
      },
      nextFetchTime: BigInt(Date.now())
    };

    await insertToDB(QueueModel, newQueueDoc);

    return res.status(200).send({ txId: randomId });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};

export const getDecryptedActionSeedCode = (doc: ClaimBuilderDoc<NumberType>) => {
  const decryptedInfo = getCorePlugin('codes').decryptPrivateParams({
    codes: doc.action.codes ?? [],
    seedCode: doc.action.seedCode ?? ''
  });
  return decryptedInfo.seedCode;
};

export const getDecryptedActionCodes = (doc: ClaimBuilderDoc<NumberType>) => {
  const maxUses = getFirstMatchForPluginType('numUses', doc.plugins)?.publicParams.maxUses ?? 0;
  const decryptedInfo = getCorePlugin('codes').decryptPrivateParams({
    codes: doc.action.codes ?? [],
    seedCode: doc.action.seedCode ?? ''
  });
  const codes = decryptedInfo.seedCode ? generateCodesFromSeed(decryptedInfo.seedCode, maxUses) : decryptedInfo.codes;
  return codes;
};

const addToAddressListAction = async (doc: ClaimBuilderDoc<NumberType>, cosmosAddress: string, session: ClientSession) => {
  const listId = doc.action.listId ?? '';
  const listDoc = await mustGetFromDB(AddressListModel, listId, session);
  const address = cosmosAddress;

  const activityDocs: Array<ListActivityDoc<bigint>> = [];
  await AddressListModel.findOneAndUpdate({ _docId: listId }, { $push: { addresses: convertToCosmosAddress(address) } }, { session })
    .lean()
    .exec();
  const newDoc = await mustGetFromDB(AddressListModel, listId, session);
  const status = await getStatus();
  getActivityDocsForListUpdate(newDoc, listDoc, status, activityDocs, address);
  await insertMany(ListActivityModel, activityDocs, session);
};

const distributeCodeAction = (doc: ClaimBuilderDoc<NumberType>, currCodeIdx: NumberType) => {
  const codes = getDecryptedActionCodes(doc);
  return codes[Number(currCodeIdx)];
};

const performBalanceClaimAction = async (doc: iClaimBuilderDoc<NumberType>, session: ClientSession) => {
  const collectionId = doc.collectionId.toString();

  const claimDoc = doc;
  const currBalancesDoc = await getFromDB(DigitalOceanBalancesModel, collectionId.toString(), session);
  const balanceMap = currBalancesDoc?.balances ?? {};
  const numUsesPluginId = getFirstMatchForPluginType('numUses', claimDoc.plugins)?.id;

  const entries = Object.entries(claimDoc?.state[`${numUsesPluginId}`].claimedUsers);
  let mostRecentAddress = '';
  let mostRecentIdx = -1;
  for (const entry of entries) {
    const idxs: number[] = (entry[1] as number[]).map((x) => Number(x));
    for (const claimIdx of idxs) {
      if (claimIdx > mostRecentIdx) {
        mostRecentIdx = claimIdx;
        mostRecentAddress = entry[0];
      }
    }
  }
  if (!mostRecentAddress || mostRecentIdx === -1) {
    throw new Error('No most recent address found');
  }

  const currBalances = BalanceArray.From(balanceMap[mostRecentAddress] ?? []).convert(BigIntify);

  if (claimDoc.action.balancesToSet?.incrementedBalances.startBalances.length) {
    const balancesToAdd = BalanceArray.From(claimDoc.action.balancesToSet?.incrementedBalances.startBalances ?? []).convert(BigIntify);
    balancesToAdd.applyIncrements(
      BigInt(claimDoc.action.balancesToSet?.incrementedBalances.incrementBadgeIdsBy ?? 0n),
      BigInt(claimDoc.action.balancesToSet?.incrementedBalances.incrementOwnershipTimesBy ?? 0n),
      BigInt(mostRecentIdx)
    );

    currBalances.addBalances(balancesToAdd);
    balanceMap[mostRecentAddress] = currBalances;
  } else if (claimDoc.action.balancesToSet?.manualBalances.length) {
    const balancesToAdd = BalanceArray.From(claimDoc.action.balancesToSet?.manualBalances?.[mostRecentIdx].balances ?? []).convert(BigIntify);
    currBalances.addBalances(balancesToAdd);
    balanceMap[mostRecentAddress] = currBalances;
  }

  const collection = await getFromDB(CollectionModel, collectionId.toString(), session);
  const currUriPath =
    collection?.offChainBalancesMetadataTimeline
      .find((x) => x.timelineTimes.searchIfExists(Date.now()))
      ?.offChainBalancesMetadata.uri.split('/')
      .pop() ?? '';

  await addBalancesToOffChainStorage(balanceMap, 'centralized', collectionId, currUriPath, session);
  await refreshCollection(collectionId.toString(), true);
};
