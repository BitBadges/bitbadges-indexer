import {
  ClaimBuilderDoc,
  ClaimIntegrationPluginType,
  GetClaimsRouteRequestBody,
  IncrementedBalances,
  IntegrationPluginDetails,
  ListActivityDoc,
  TransferWithIncrements,
  convertToCosmosAddress,
  createBalanceMapForOffChainBalances,
  iGetClaimsRouteSuccessResponse,
  mustConvertToCosmosAddress,
  type ErrorResponse,
  type NumberType,
  type iCheckAndCompleteClaimRouteSuccessResponse
} from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { serializeError } from 'serialize-error';
import { RequiresSignaturePluginDetails } from '../integrations/signature';
import { TransferTimesPluginDetails } from '../integrations/transferTimes';
import { WhitelistPluginDetails } from '../integrations/whitelist';
import { type AuthenticatedRequest } from '../blockin/blockin_handlers';
import { getFromDB, insertMany, mustGetFromDB } from '../db/db';
import { findInDB } from '../db/queries';
import { AddressListModel, ClaimBuilderModel, CollectionModel, ListActivityModel } from '../db/schemas';
import { getStatus } from '../db/status';
import { DiscordPluginDetails, TwitterPluginDetails } from '../integrations/auth';
import { CodesPluginDetails, generateCodesFromSeed } from '../integrations/codes';
import { MinBalancePluginDetails } from '../integrations/minBalance';
import { NumUsesDetails } from '../integrations/numUses';
import { PasswordPluginDetails } from '../integrations/passwords';
import { BackendIntegrationPlugin, ContextInfo, getPlugin, getPluginParamsAndState } from '../integrations/types';
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
  greaterThanXBADGEBalance: MinBalancePluginDetails,
  transferTimes: TransferTimesPluginDetails,
  requiresProofOfAddress: RequiresSignaturePluginDetails,
  whitelist: WhitelistPluginDetails
};

enum ActionType {
  Code = 'Code',
  SetBalance = 'SetBalance',
  AddToList = 'AddToList'
}

export interface ClaimDetails<T extends NumberType> {
  claimId: string;
  balancesToSet?: IncrementedBalances<T>;
  plugins: IntegrationPluginDetails<ClaimIntegrationPluginType>[];
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
        //We need to check if they are for a private / viewable with link only list
        //If so, we have to return blank public state unless they can prove they have permissions
        const addressListDoc = await mustGetFromDB(AddressListModel, doc.action.listId);
        let hasPermissions = addressListDoc.private || addressListDoc.viewableWithLink ? false : true;
        if (addressListDoc.private) {
          hasPermissions = hasPermissions || req.session.cosmosAddress === addressListDoc.createdBy;
        }
        //Prove knowledge of list link by specifying listId
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
      cosmosAddress: cosmosAddress,
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

    let actionType = ActionType.Code;
    if (claimBuilderDoc.action.balancesToSet) {
      actionType = ActionType.SetBalance;
    } else if (claimBuilderDoc.action.listId) {
      actionType = ActionType.AddToList;
    }

    if (actionType === ActionType.Code || actionType === ActionType.SetBalance || actionType === ActionType.AddToList) {
      if (!claimBuilderDoc.plugins.find((plugin) => plugin.id === 'numUses')) {
        throw new Error('No numUses plugin found');
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
        default:
          break;
      }

      const result = await pluginInstance.validateFunction(
        context,
        Object.freeze(plugin.publicParams),
        Object.freeze(pluginInstance.decryptPrivateParams(plugin.privateParams)),
        pluginInstance.metadata.stateless ? undefined : req.body[plugin.id],
        pluginInstance.metadata.stateless ? undefined : claimBuilderDoc.state[plugin.id],
        pluginInstance.metadata.scoped ? undefined : Object.freeze(claimBuilderDoc.state),
        adminInfo
      );

      results.push(result);

      //If we failed but have fetched a prior code, we return it
      if (plugin.id === 'numUses' && !result.success && actionType === ActionType.Code) {
        const idx = result.data?.idx;
        if (idx !== undefined) {
          const codes = getDecryptedActionCodes(claimBuilderDoc);
          return res.status(200).send({
            code: codes[idx]
          });
        }
      } else if (!result.success) {
        return res.status(400).send({
          error: result.error,
          errorMessage: 'Error getting codes. One or more of the challenges were not satisfied. ' + result.error
        });
      }
    }

    const setters = results
      .map((result) => result.toSet)
      .filter((x) => x)
      .flat();

    // Find the doc, increment currCode, and add the given code idx to claimedUsers
    const newDoc = await ClaimBuilderModel.findOneAndUpdate(
      {
        ...query,
        _docId: claimBuilderDoc._docId,
        [`state.numUses.claimedUsers.${context.cosmosAddress}`]: { $exists: false }
      },
      setters,
      { new: true }
    )
      .lean()
      .exec();
    if (!newDoc) {
      throw new Error('No doc found');
    }

    //Perform Actions
    if (actionType === ActionType.SetBalance) {
      await performBalanceClaimAction(newDoc as ClaimBuilderDoc<NumberType>);
      return res.status(200).send();
    } else if (actionType === ActionType.Code) {
      const numUsesIdx = newDoc.plugins.findIndex((plugin) => plugin.id === 'numUses');
      const numUsesResult = results[numUsesIdx];
      const currCodeIdx = numUsesResult.data?.idx;
      const code = await distributeCodeAction(newDoc as ClaimBuilderDoc<NumberType>, currCodeIdx);
      return res.status(200).send({ code });
    } else if (actionType === ActionType.AddToList && claimBuilderDoc.action.listId) {
      await addToAddressListAction(newDoc as ClaimBuilderDoc<NumberType>, context.cosmosAddress);
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

  const alreadyOnList = listDoc.addresses.map((x) => convertToCosmosAddress(x)).includes(convertToCosmosAddress(address));
  if (alreadyOnList) {
    throw new Error('Address already on list');
  }

  // TODO: Session?
  await AddressListModel.findOneAndUpdate({ _docId: listId }, { $push: { addresses: convertToCosmosAddress(address) } })
    .lean()
    .exec();
  const newDoc = await mustGetFromDB(AddressListModel, listId);
  const status = await getStatus();
  getActivityDocsForListUpdate(newDoc, listDoc, status, activityDocs);
  await insertMany(ListActivityModel, activityDocs);
};

const distributeCodeAction = async (doc: ClaimBuilderDoc<NumberType>, currCodeIdx: NumberType) => {
  const codes = getDecryptedActionCodes(doc);
  return codes[Number(currCodeIdx)];
};

const performBalanceClaimAction = async (doc: ClaimBuilderDoc<NumberType>) => {
  const collectionId = doc.collectionId.toString();
  const entries = Object.entries(doc?.state.numUses.claimedUsers);
  //Sort by claimedUsers value
  entries.sort((a: any, b: any) => Number(a[1]) - Number(b[1]));

  const users = entries.map((entry) => entry[0]);

  const balances = await createBalanceMapForOffChainBalances([
    new TransferWithIncrements({
      //claimedUsers
      from: 'Mint',
      toAddresses: users,
      balances: doc.action.balancesToSet?.startBalances ?? [],
      incrementBadgeIdsBy: doc.action.balancesToSet?.incrementBadgeIdsBy,
      incrementOwnershipTimesBy: doc.action.balancesToSet?.incrementOwnershipTimesBy
    })
  ]);

  const collection = await getFromDB(CollectionModel, collectionId.toString());
  const currUriPath = collection?.offChainBalancesMetadataTimeline
    .find((x) => x.timelineTimes.searchIfExists(Date.now()))
    ?.offChainBalancesMetadata.uri.split('/')
    .pop();

  await addBalancesToOffChainStorage(balances, 'centralized', collectionId, currUriPath);
  await refreshCollection(collectionId.toString(), true);
};
