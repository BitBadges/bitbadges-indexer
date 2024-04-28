import {
  BalanceArray,
  BigIntify,
  convertToCosmosAddress,
  mustConvertToCosmosAddress,
  ClaimBuilderDoc,
  type ClaimIntegrationPluginType,
  type ErrorResponse,
  type GetClaimsRouteRequestBody,
  type ListActivityDoc,
  type NumberType,
  type iCheckAndCompleteClaimRouteSuccessResponse,
  type iGetClaimsRouteSuccessResponse,
  iClaimBuilderDoc
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { setMockSessionIfTestMode, type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import {
  AddressListModel,
  ClaimBuilderModel,
  CollectionModel,
  DigitalOceanBalancesModel,
  ExternalCallKeysModel,
  ListActivityModel,
  ProfileModel
} from '../db/schemas';
import { getStatus } from '../db/status';
import { ApiPluginDetails } from '../integrations/api';
import { DiscordPluginDetails, EmailPluginDetails, GitHubPluginDetails, GooglePluginDetails, TwitterPluginDetails } from '../integrations/auth';
import { CodesPluginDetails, generateCodesFromSeed } from '../integrations/codes';
import { MustOwnPluginDetails } from '../integrations/mustOwnBadges';
import { NumUsesDetails } from '../integrations/numUses';
import { PasswordPluginDetails } from '../integrations/passwords';
import { RequiresSignaturePluginDetails } from '../integrations/signature';
import { TransferTimesPluginDetails } from '../integrations/transferTimes';
import { getPlugin, getPluginParamsAndState, type BackendIntegrationPlugin, type ContextInfo } from '../integrations/types';
import { WhitelistPluginDetails } from '../integrations/whitelist';
import { addBalancesToOffChainStorage } from '../ipfs/ipfs';
import { getActivityDocsForListUpdate } from './addressLists';
import { getClaimDetailsForFrontend } from './collections';
import { refreshCollection } from './refresh';

export const Plugins: { [key in ClaimIntegrationPluginType]: BackendIntegrationPlugin<key> } = {
  codes: CodesPluginDetails,
  twitter: TwitterPluginDetails,
  discord: DiscordPluginDetails,
  password: PasswordPluginDetails,
  numUses: NumUsesDetails,
  transferTimes: TransferTimesPluginDetails,
  requiresProofOfAddress: RequiresSignaturePluginDetails,
  whitelist: WhitelistPluginDetails,
  mustOwnBadges: MustOwnPluginDetails,
  api: ApiPluginDetails,
  github: GitHubPluginDetails,
  google: GooglePluginDetails,
  email: EmailPluginDetails
};

enum ActionType {
  Code = 'Code',
  SetBalance = 'SetBalance',
  AddToList = 'AddToList',
  ClaimNumbers = 'ClaimNumbers'
}

// export interface ClaimDetails<T extends NumberType> {
//   claimId: string;
//   balancesToSet?: IncrementedBalances<T>;
//   plugins: Array<IntegrationPluginDetails<ClaimIntegrationPluginType>>;
//   manualDistribution?: boolean;
// }

export const getClaimsHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimsRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqBody = req.body as GetClaimsRouteRequestBody;
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
            plugin.publicState = getPlugin(plugin.id).getBlankPublicState();
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

export const checkAndCompleteClaim = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iCheckAndCompleteClaimRouteSuccessResponse | ErrorResponse>
) => {
  try {
    setMockSessionIfTestMode(req);

    const claimId = req.params.claimId;
    const query = { _docId: claimId, docClaimed: true, deletedAt: { $exists: false } };

    const cosmosAddress = mustConvertToCosmosAddress(req.params.cosmosAddress);
    const context: ContextInfo = Object.freeze({
      cosmosAddress,
      claimId
    });

    const claimBuilderDocResponse = await findInDB(ClaimBuilderModel, { query, limit: 1 });
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

    if (!claimBuilderDoc.plugins.find((plugin) => plugin.id === 'numUses')) {
      throw new Error('No numUses plugin found');
    }

    if (actionType === ActionType.Code && req.body.prevCodesOnly) {
      const prevUsedIdxs = claimBuilderDoc.state.numUses.claimedUsers[context.cosmosAddress] ?? [];

      if (prevUsedIdxs !== undefined) {
        const codes = getDecryptedActionCodes(claimBuilderDoc);
        return res.status(200).send({
          prevCodes: prevUsedIdxs.map((idx: number) => codes[Number(idx)])
        });
      }
    }

    // Pass in email only if previously set up and verified
    // Must be logged in
    let email = '';
    const requiresEmail = getPluginParamsAndState('api', claimBuilderDoc.plugins)?.publicParams.apiCalls?.find((x) => x.passEmail);
    if (req.session.cosmosAddress && requiresEmail) {
      const profileDoc = await mustGetFromDB(ProfileModel, req.session.cosmosAddress);
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

    const results = [];
    for (const plugin of claimBuilderDoc.plugins) {
      const pluginInstance = getPlugin(plugin.id);

      let adminInfo = {};

      switch (plugin.id) {
        case 'requiresProofOfAddress':
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
            assignMethod: getPluginParamsAndState('numUses', claimBuilderDoc.plugins)?.publicParams.assignMethod
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
        case 'api': {
          adminInfo = {
            discord: req.session.discord,
            twitter: req.session.twitter,
            github: req.session.github,
            google: req.session.google,
            email
          };
          break;
        }

        default:
          break;
      }

      const result = await pluginInstance.validateFunction(
        context,
        Object.freeze(plugin.publicParams),
        Object.freeze(pluginInstance.decryptPrivateParams(plugin.privateParams)),
        req.body[plugin.id],
        pluginInstance.metadata.stateless ? undefined : claimBuilderDoc.state[plugin.id],
        pluginInstance.metadata.scoped ? undefined : Object.freeze(claimBuilderDoc.state),
        adminInfo
      );

      results.push(result);

      if (!result.success) {
        return res.status(400).send({
          error: result.error,
          errorMessage: 'One or more of the challenges were not satisfied. ' + result.error
        });
      }
    }

    const setters = results
      .map((result) => result.toSet)
      .filter((x) => x)
      .flat();

    const prevFetchedSize = claimBuilderDoc.state.numUses.claimedUsers[context.cosmosAddress]?.length ?? 0;
    let consistencyQuery: any = {
      $size: prevFetchedSize
    };
    if (!prevFetchedSize) {
      consistencyQuery = {
        $exists: false
      };
    }

    let codeConsistencyQuery: any = {};
    const assignMethod = getPluginParamsAndState('numUses', claimBuilderDoc.plugins)?.publicParams.assignMethod;
    if (assignMethod === 'firstComeFirstServe') {
      // Handled by the $size query
    } else if (assignMethod === 'codeIdx') {
      const params = getPluginParamsAndState('codes', claimBuilderDoc.plugins);
      const privateParams = getPlugin('codes').decryptPrivateParams(params?.privateParams ?? { codes: [], seedCode: '' });
      const maxUses = getPluginParamsAndState('numUses', claimBuilderDoc.plugins)?.publicParams.maxUses ?? 0;
      if (!privateParams) {
        throw new Error('No private params found');
      }

      const seedCode = privateParams.seedCode;
      const codes = privateParams.seedCode ? generateCodesFromSeed(seedCode, maxUses) : privateParams.codes;
      if ((codes.length === 0 && !seedCode) || codes.length !== maxUses) {
        throw new Error('Invalid configuration');
      }

      const codeToCheck = req.body.codes.code;
      if (!codes.includes(codeToCheck)) {
        throw new Error('invalid code');
      }

      const codeIdx = codes.indexOf(codeToCheck);
      if (codeIdx === -1) {
        throw new Error('invalid code');
      }

      codeConsistencyQuery = {
        [`state.codes.usedCodeIndices.${codeIdx}`]: { $exists: false }
      };
    }

    // TODO: Session w/ the action updates as well?
    // Find the doc, increment currCode, and add the given code idx to claimedUsers
    const newDoc = await ClaimBuilderModel.findOneAndUpdate(
      {
        ...query,
        _docId: claimBuilderDoc._docId,
        [`state.numUses.claimedUsers.${context.cosmosAddress}`]: consistencyQuery,
        ...codeConsistencyQuery
      },
      setters,
      { new: true }
    )
      .lean()
      .exec();
    if (!newDoc) {
      throw new Error('No doc found');
    }

    // Perform Actions
    if (actionType === ActionType.SetBalance) {
      await performBalanceClaimAction(newDoc as ClaimBuilderDoc<NumberType>);
      return res.status(200).send();
    } else if (actionType === ActionType.Code) {
      const currCodeIdx = newDoc.state.numUses.claimedUsers[context.cosmosAddress].pop();
      const code = distributeCodeAction(newDoc as ClaimBuilderDoc<NumberType>, currCodeIdx);
      const prevUsedCodes = newDoc.state.numUses.claimedUsers[context.cosmosAddress].slice(0, -1);

      return res
        .status(200)
        .send({ prevCodes: prevUsedCodes.map((idx: number) => distributeCodeAction(newDoc as ClaimBuilderDoc<NumberType>, idx)), code });
    } else if (actionType === ActionType.AddToList && claimBuilderDoc.action.listId) {
      await addToAddressListAction(newDoc as ClaimBuilderDoc<NumberType>, context.cosmosAddress);
      return res.status(200).send();
    } else if (actionType === ActionType.ClaimNumbers) {
      return res.status(200).send();
    }

    throw new Error('No action found');
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: 'Error getting codes. ' + e.message
    });
  }
};

export const getDecryptedActionSeedCode = (doc: ClaimBuilderDoc<NumberType>) => {
  const decryptedInfo = getPlugin('codes').decryptPrivateParams({
    codes: doc.action.codes ?? [],
    seedCode: doc.action.seedCode ?? ''
  });
  return decryptedInfo.seedCode;
};

export const getDecryptedActionCodes = (doc: ClaimBuilderDoc<NumberType>) => {
  const maxUses = getPluginParamsAndState('numUses', doc.plugins)?.publicParams.maxUses ?? 0;
  const decryptedInfo = getPlugin('codes').decryptPrivateParams({
    codes: doc.action.codes ?? [],
    seedCode: doc.action.seedCode ?? ''
  });
  const codes = decryptedInfo.seedCode ? generateCodesFromSeed(decryptedInfo.seedCode, maxUses) : decryptedInfo.codes;
  return codes;
};

const addToAddressListAction = async (doc: ClaimBuilderDoc<NumberType>, cosmosAddress: string) => {
  const listId = doc.action.listId ?? '';
  const listDoc = await mustGetFromDB(AddressListModel, listId);
  const address = cosmosAddress;

  const activityDocs: Array<ListActivityDoc<bigint>> = [];
  // TODO: Session?
  await AddressListModel.findOneAndUpdate({ _docId: listId }, { $push: { addresses: convertToCosmosAddress(address) } })
    .lean()
    .exec();
  const newDoc = await mustGetFromDB(AddressListModel, listId);
  const status = await getStatus();
  getActivityDocsForListUpdate(newDoc, listDoc, status, activityDocs, address);
  await insertMany(ListActivityModel, activityDocs);
};

const distributeCodeAction = (doc: ClaimBuilderDoc<NumberType>, currCodeIdx: NumberType) => {
  const codes = getDecryptedActionCodes(doc);
  return codes[Number(currCodeIdx)];
};

const performBalanceClaimAction = async (doc: iClaimBuilderDoc<NumberType>) => {
  const collectionId = doc.collectionId.toString();

  const claimDoc = doc;
  const currBalancesDoc = await getFromDB(DigitalOceanBalancesModel, collectionId.toString());
  const balanceMap = currBalancesDoc?.balances ?? {};

  const entries = Object.entries(claimDoc?.state.numUses.claimedUsers);
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

  const collection = await getFromDB(CollectionModel, collectionId.toString());
  const currUriPath = collection?.offChainBalancesMetadataTimeline
    .find((x) => x.timelineTimes.searchIfExists(Date.now()))
    ?.offChainBalancesMetadata.uri.split('/')
    .pop();

  await addBalancesToOffChainStorage(balanceMap, 'centralized', collectionId, currUriPath);
  await refreshCollection(collectionId.toString(), true);
};

export const externalApiCallKeyCheckHandler = async (req: Request, res: Response) => {
  try {
    const uri = req.body.uri;
    if (!uri) {
      throw new Error('uri is required');
    }

    const key = req.body.key;
    if (!key) {
      throw new Error('key is required');
    }

    const keysDoc = await mustGetFromDB(ExternalCallKeysModel, uri);

    const matchingKey = keysDoc.keys.find((k) => k.key === key);
    if (!matchingKey) {
      throw new Error('Key not found');
    }

    return res.status(200).send({
      timestamp: matchingKey.timestamp,
      key: matchingKey.key
    });
  } catch (e) {
    console.error(e);
    return res.status(500).send({
      error: serializeError(e),
      errorMessage: e.message
    });
  }
};
