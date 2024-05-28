import {
  ClaimIntegrationPrivateStateType,
  PluginDoc,
  PluginPresetType,
  type ClaimIntegrationPluginType,
  type ClaimIntegrationPrivateParamsType,
  type ClaimIntegrationPublicParamsType,
  type ClaimIntegrationPublicStateType,
  type IntegrationPluginParams
} from 'bitbadgesjs-sdk';
import { mustGetFromDB } from '../db/db';
import { PluginModel } from '../db/schemas';
import { Plugins } from '../routes/claims';
import { GenericCustomPluginValidateFunction } from './api';
import { GenericOauthValidateFunction } from './auth';
import { Setter } from './codes';

export interface ContextInfo {
  cosmosAddress: string;
  claimId: string;
  _isSimulation: boolean;
  lastUpdated: number;
  createdAt: number;
}

export interface IntegrationMetadata {
  name: string;
  description: string;
  image: string;
  createdBy: string;
  stateless: boolean;
  scoped: boolean;
  duplicatesAllowed: boolean;
}

export type ClaimIntegrationCustomBodyType<T extends ClaimIntegrationPluginType> = T extends 'password'
  ? { password: string }
  : T extends 'codes'
    ? { code: string }
    : object;

export interface BackendIntegrationPlugin<P extends ClaimIntegrationPluginType> {
  type: P;
  metadata: IntegrationMetadata;
  validateFunction: (
    context: ContextInfo & { pluginId: string; pluginType: string },
    publicParams: ClaimIntegrationPublicParamsType<P>,
    privateParams: ClaimIntegrationPrivateParamsType<P>,
    customBody?: ClaimIntegrationCustomBodyType<P>, // if stateless, we will have no customBody
    priorState?: any, // if stateless, we will have no priorState
    globalState?: any, // if not scoped, we will have a readonly globalState
    adminInfo?: any // if not scoped, we will have a readonly globalState
  ) => Promise<{ success: boolean; error?: string; toSet?: object[]; data?: any }>;
  defaultState: any;
  getPublicState: (currState: any) => ClaimIntegrationPublicStateType<P>;
  getPrivateState?: (currState: any) => ClaimIntegrationPrivateStateType<P>;
  getBlankPublicState: () => ClaimIntegrationPublicStateType<P>;
  decryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<P>) => ClaimIntegrationPrivateParamsType<P>;
  encryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<P>) => ClaimIntegrationPrivateParamsType<P>;
}

interface CustomIntegrationPlugin<T extends ClaimIntegrationPluginType> {
  type: T;
  responseHandler?: (data: any) => Promise<{ success: boolean; error?: string; toSet?: object[] }>;
  validateFunction?: (
    context: ContextInfo & { pluginId: string; pluginType: string },
    publicParams: ClaimIntegrationPublicParamsType<T>,
    privateParams: ClaimIntegrationPrivateParamsType<T>,
    customBody?: ClaimIntegrationCustomBodyType<T>, // if stateless, we will have no customBody
    priorState?: any, // if stateless, we will have no priorState
    globalState?: any, // if not scoped, we will have a readonly globalState
    adminInfo?: any // if not scoped, we will have a readonly globalState
  ) => Promise<{ success: boolean; error?: string; toSet?: object[] }>;
  defaultState: any;
  getPublicState: (currState: any) => ClaimIntegrationPublicStateType<T>;
  getPrivateState?: (currState: any) => ClaimIntegrationPrivateStateType<T>;
  getBlankPublicState: () => ClaimIntegrationPublicStateType<T>;
  decryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<T>) => ClaimIntegrationPrivateParamsType<T>;
  encryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<T>) => ClaimIntegrationPrivateParamsType<T>;
}

const CustomPluginFunctions: { [key: string]: CustomIntegrationPlugin<any> } = {
  //Here, developers can submit PRs with their own functions for custom plugins
};

export const castPluginDocToPlugin = <T extends ClaimIntegrationPluginType>(doc: PluginDoc<bigint>): BackendIntegrationPlugin<T> => {
  return {
    type: doc.pluginId as T,
    metadata: {
      ...doc.metadata,
      duplicatesAllowed: doc.duplicatesAllowed,
      stateless: doc.stateFunctionPreset === PluginPresetType.Stateless,
      scoped: false
    },
    validateFunction: async (context, publicParams, privateParams, customBody, priorState, globalState, adminInfo) => {
      let responseHandler = undefined;
      if (doc.stateFunctionPreset === PluginPresetType.Usernames) {
        responseHandler = async (data: any) => {
          const { id, username } = data;
          if (!id || !username) {
            return { success: false, error: 'Invalid response from API' };
          }

          return GenericOauthValidateFunction(
            publicParams as any,
            privateParams as any,
            {},
            priorState,
            globalState,
            { id, username },
            context.pluginId
          );
        };
      } else if (doc.stateFunctionPreset === PluginPresetType.ClaimToken) {
        responseHandler = async (axiosRes: any) => {
          const pluginId = context.pluginId;
          const claimToken = axiosRes.data.claimToken?.toString();
          if (!claimToken) {
            return { success: false, error: 'Invalid response from API' };
          }

          if (priorState.usedTokens[claimToken]) {
            return { success: false, error: 'Claim token already used' };
          }

          const toSet: Setter[] = [{ $set: { [`state.${pluginId}.usedTokens.${claimToken}`]: 1 } }];

          return {
            success: true,
            toSet
          };
        };
      } else if (doc.stateFunctionPreset === PluginPresetType.CompletelyCustom) {
        if (!CustomPluginFunctions[doc.pluginId]) {
          throw new Error('Custom plugin not found');
        }
        const customPlugin = CustomPluginFunctions[doc.pluginId];

        if (!customPlugin.validateFunction) {
          throw new Error('Custom plugin missing validate function.');
        }

        throw new Error('Not implemented');

        //TODO: Add completely custom plugin option?
        // if (customPlugin.validateFunction) {
        //   //IMPORTANT: adminInfo has all public info passed, we should not send it out for custom plugins
        //   return await customPlugin.validateFunction(context, publicParams, privateParams, customBody, priorState, globalState, {});
        // }
      } else if (doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler) {
        if (!CustomPluginFunctions[doc.pluginId]) {
          throw new Error('Custom plugin not found');
        }
        const customPlugin = CustomPluginFunctions[doc.pluginId];

        if (!customPlugin.responseHandler) {
          throw new Error('Custom plugin missing response handler.');
        }

        responseHandler = customPlugin.responseHandler;
      } else if (doc.stateFunctionPreset === PluginPresetType.StateTransitions) {
        responseHandler = async (axiosRes: any) => {
          const pluginId = context.pluginId;
          const newState = JSON.parse(JSON.stringify(axiosRes.data.newState));
          if (!newState) {
            return { success: false, error: 'Invalid response from API' };
          }

          return {
            success: true,
            toSet: [{ $set: { [`state.${pluginId}`]: newState } }]
          };
        };
      }

      return await GenericCustomPluginValidateFunction(
        context,
        publicParams,
        privateParams,
        customBody,
        priorState,
        globalState,
        adminInfo,
        responseHandler,
        doc.stateFunctionPreset
      );
    },
    defaultState:
      doc.stateFunctionPreset === PluginPresetType.Usernames
        ? { ids: {}, usernames: {} }
        : doc.stateFunctionPreset === PluginPresetType.Stateless
          ? {}
          : doc.stateFunctionPreset === PluginPresetType.CompletelyCustom || doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler
            ? CustomPluginFunctions[doc.pluginId].defaultState
            : { usedTokens: {} },
    getPublicState: () => {
      if (doc.stateFunctionPreset === PluginPresetType.CompletelyCustom || doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler) {
        return CustomPluginFunctions[doc.pluginId].getPublicState({}) as ClaimIntegrationPublicStateType<T>;
      }

      return {} as ClaimIntegrationPublicStateType<T>;
    },
    getBlankPublicState: () => {
      if (doc.stateFunctionPreset === PluginPresetType.CompletelyCustom || doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler) {
        return CustomPluginFunctions[doc.pluginId].getBlankPublicState() as ClaimIntegrationPublicStateType<T>;
      }

      return {} as ClaimIntegrationPublicStateType<T>;
    },
    decryptPrivateParams: (privateParams) => {
      if (doc.stateFunctionPreset === PluginPresetType.CompletelyCustom || doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler) {
        return CustomPluginFunctions[doc.pluginId].decryptPrivateParams(privateParams) as ClaimIntegrationPrivateParamsType<T>;
      }

      return privateParams as ClaimIntegrationPrivateParamsType<T>;
    },
    encryptPrivateParams: (privateParams) => {
      if (doc.stateFunctionPreset === PluginPresetType.CompletelyCustom || doc.stateFunctionPreset === PluginPresetType.CustomResponseHandler) {
        return CustomPluginFunctions[doc.pluginId].encryptPrivateParams(privateParams) as ClaimIntegrationPrivateParamsType<T>;
      }

      return privateParams as ClaimIntegrationPrivateParamsType<T>;
    }
  };
};

export const getCorePlugin = <T extends ClaimIntegrationPluginType>(type: T): BackendIntegrationPlugin<T> => {
  return Plugins[type] as BackendIntegrationPlugin<T>;
};

export const getPlugin = async <T extends ClaimIntegrationPluginType>(type: T): Promise<BackendIntegrationPlugin<T>> => {
  if (!Plugins[type]) {
    const doc = await mustGetFromDB(PluginModel, type);
    return castPluginDocToPlugin(doc);
  }

  return Plugins[type as ClaimIntegrationPluginType] as BackendIntegrationPlugin<T>;
};

//The ones where duplicates are not allowed
export const getFirstMatchForPluginType = <T extends ClaimIntegrationPluginType>(
  type: T,
  detailsArr: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>
): IntegrationPluginParams<T> | undefined => {
  return detailsArr.find((details) => details.pluginId === type) as IntegrationPluginParams<T>;
};

export const encryptPlugins = async (
  plugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>
): Promise<IntegrationPluginParams<ClaimIntegrationPluginType>[]> => {
  const SYM_KEY = process.env.SYM_KEY;
  if (!SYM_KEY) {
    throw new Error('No symmetric key found');
  }
  const pluginsRes = [];
  for (const plugin of plugins) {
    if (!plugin) throw new Error('No plugin found');

    const pluginInstance = await getPlugin(plugin.pluginId);
    pluginsRes.push({ ...plugin, privateParams: pluginInstance.encryptPrivateParams(plugin.privateParams) });
  }

  return pluginsRes;
};
