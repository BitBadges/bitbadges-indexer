import {
  BalanceArray,
  type ClaimBuilderDoc,
  type ClaimIntegrationPluginType,
  type GetClaimsRouteRequestBody,
  type IncrementedBalances,
  type IntegrationPluginDetails,
  type ListActivityDoc,
  convertToCosmosAddress,
  type iGetClaimsRouteSuccessResponse,
  type iOffChainBalancesMap,
  mustConvertToCosmosAddress,
  type ErrorResponse,
  type NumberType,
  type iCheckAndCompleteClaimRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Request, type Response } from 'express';
import { serializeError } from 'serialize-error';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AddressListModel, ClaimBuilderModel, CollectionModel, ExternalCallKeysModel, ListActivityModel, ProfileModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { ApiPluginDetails } from '../integrations/api';
import { DiscordPluginDetails, EmailPluginDetails, GitHubPluginDetails, GooglePluginDetails, TwitterPluginDetails } from '../integrations/auth';
import { CodesPluginDetails, generateCodesFromSeed } from '../integrations/codes';
import { MustOwnPluginDetails } from '../integrations/mustOwnBadges';
import { NumUsesDetails } from '../integrations/numUses';
import { PasswordPluginDetails } from '../integrations/passwords';
import { RequiresSignaturePluginDetails } from '../integrations/signature';
import { TransferTimesPluginDetails } from '../integrations/transferTimes';
import { type BackendIntegrationPlugin, type ContextInfo, getPlugin, getPluginParamsAndState } from '../integrations/types';
import { WhitelistPluginDetails } from '../integrations/whitelist';
import { addBalancesToOffChainStorage } from '../ipfs/ipfs';
import { getActivityDocsForListUpdate } from './addressLists';
import { getClaimDetailsForFrontend } from './collections';
import { refreshCollection } from './refresh';

export const Plugins: { [key in ClaimIntegrationPluginType]: BackendIntegrationPlugin<NumberType, key> } = {
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

export interface ClaimDetails<T extends NumberType> {
  claimId: string;
  balancesToSet?: IncrementedBalances<T>;
  plugins: Array<IntegrationPluginDetails<ClaimIntegrationPluginType>>;
  manualDistribution?: boolean;
}

export const getClaimsHandler = async (
  req: AuthenticatedRequest<NumberType>,
  res: Response<iGetClaimsRouteSuccessResponse<NumberType> | ErrorResponse>
) => {
  try {
    const reqBody = req.body as GetClaimsRouteRequestBody;
    const query = { docClaimed: true, _docId: { $in: reqBody.claimIds } };
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
    const claimId = req.params.claimId;
    const query = { _docId: claimId, docClaimed: true };

    const cosmosAddress = mustConvertToCosmosAddress(req.params.cosmosAddress);
    const context: ContextInfo = Object.freeze({
      cosmosAddress,
      claimId
    });

    const claimBuilderDocResponse = await findInDB(ClaimBuilderModel, { query, limit: 1 });
    if (claimBuilderDocResponse.length === 0) {
      throw new Error('No password doc found');
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
    if (req.session.cosmosAddress) {
      const profileDoc = await mustGetFromDB(ProfileModel, req.session.cosmosAddress);
      if (!profileDoc) {
        throw new Error('No profile found');
      }
      if (profileDoc.notifications?.email) {
        if (profileDoc.notifications.emailVerification?.verified) {
          email = profileDoc.notifications.email;
        }
      }
    } else {
      if (getPluginParamsAndState('api', claimBuilderDoc.plugins)?.publicParams.apiCalls?.find((x) => x.passEmail)) {
        throw new Error('Email required but user is not logged in to BitBadges');
      }
    }

    const results = [];
    for (const plugin of claimBuilderDoc.plugins) {
      const pluginInstance = getPlugin(plugin.id);

      let adminInfo = {};
      if (process.env.TEST_MODE === 'true') {
        switch (plugin.id) {
          case 'requiresProofOfAddress':
            adminInfo = {
              cosmosAddress: 'cosmos1tqg2v8h5y9a2t7n4q9f4p7f8d8t7n4q9f4p7f',
              blockin: true
            };
            break;

          case 'codes': {
            adminInfo = {
              assignMethod: getPluginParamsAndState('numUses', claimBuilderDoc.plugins)?.publicParams.assignMethod
            };
            break;
          }
          case 'discord':
          case 'twitter':
          case 'github':
          case 'google':
          case 'email':
            adminInfo = {
              username: 'testuser',
              id: '123456789'
            };
            break;
          default:
            break;
        }
      } else {
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
  getActivityDocsForListUpdate(newDoc, listDoc, status, activityDocs);
  await insertMany(ListActivityModel, activityDocs);
};

const distributeCodeAction = (doc: ClaimBuilderDoc<NumberType>, currCodeIdx: NumberType) => {
  const codes = getDecryptedActionCodes(doc);
  return codes[Number(currCodeIdx)];
};

const performBalanceClaimAction = async (doc: ClaimBuilderDoc<NumberType>) => {
  const collectionId = doc.collectionId.toString();

  const allClaimDocsForCollection = await findInDB(ClaimBuilderModel, { query: { collectionId: Number(collectionId), docClaimed: true } });

  const balanceMap: iOffChainBalancesMap<NumberType> = {};

  for (const claimDoc of allClaimDocsForCollection) {
    const entries = Object.entries(claimDoc?.state.numUses.claimedUsers);
    // Sort by claimedUsers value
    entries.sort((a: any, b: any) => Number(a[1]) - Number(b[1]));

    for (const entry of entries) {
      const currBalances = BalanceArray.From(balanceMap[entry[0]] ?? []);
      const claimIdx = Number(entry[1]);

      const balancesToAdd = BalanceArray.From(claimDoc.action.balancesToSet?.startBalances ?? []);
      balancesToAdd.applyIncrements(
        claimDoc.action.balancesToSet?.incrementBadgeIdsBy ?? 0n,
        claimDoc.action.balancesToSet?.incrementOwnershipTimesBy ?? 0n,
        BigInt(claimIdx)
      );

      currBalances.addBalances(balancesToAdd);
      balanceMap[entry[0]] = currBalances;
    }
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
