import {
  type ClaimIntegrationPluginType,
  type ClaimIntegrationPrivateParamsType,
  type ClaimIntegrationPublicParamsType,
  type ClaimIntegrationPublicStateType,
  type IntegrationPluginParams,
  type NumberType
} from 'bitbadgesjs-sdk';
import { Plugins } from '../routes/claims';

export interface ContextInfo {
  cosmosAddress: string;
  claimId: string;
}

export interface IntegrationMetadata {
  name: string;
  description: string;
  image: string;
  createdBy: string;
  stateless: boolean;
  scoped: boolean;
}

export type ClaimIntegrationCustomBodyType<T extends ClaimIntegrationPluginType> = T extends 'password'
  ? { password: string }
  : T extends 'codes'
    ? { code: string }
    : T extends 'api'
      ? object[]
      : {};

export interface BackendIntegrationPlugin<T extends NumberType, P extends ClaimIntegrationPluginType> {
  id: P;
  metadata: IntegrationMetadata;
  validateFunction: (
    context: ContextInfo,
    publicParams: ClaimIntegrationPublicParamsType<P>,
    privateParams: ClaimIntegrationPrivateParamsType<P>,
    customBody?: ClaimIntegrationCustomBodyType<P>, // if stateless, we will have no customBody
    priorState?: any, // if stateless, we will have no priorState
    globalState?: any, // if not scoped, we will have a readonly globalState
    adminInfo?: any // if not scoped, we will have a readonly globalState
  ) => Promise<{ success: boolean; error?: string; toSet?: object[]; data?: any }>;
  defaultState: any;
  getPublicState: (currState: any) => ClaimIntegrationPublicStateType<P>;
  getBlankPublicState: () => ClaimIntegrationPublicStateType<P>;
  decryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<P>) => ClaimIntegrationPrivateParamsType<P>;
  encryptPrivateParams: (privateParams: ClaimIntegrationPrivateParamsType<P>) => ClaimIntegrationPrivateParamsType<P>;
}

export const getPlugin = <T extends ClaimIntegrationPluginType>(id: T): BackendIntegrationPlugin<NumberType, T> => {
  return Plugins[id];
};

export const getPluginParamsAndState = <T extends ClaimIntegrationPluginType>(
  id: T,
  detailsArr: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>
): IntegrationPluginParams<T> | undefined => {
  const plugin = detailsArr.find((details) => details.id === id);
  if (!plugin) return undefined;

  return plugin as IntegrationPluginParams<T>;
};

export const encryptPlugins = (
  plugins: Array<IntegrationPluginParams<ClaimIntegrationPluginType>>
): Array<IntegrationPluginParams<ClaimIntegrationPluginType>> => {
  const SYM_KEY = process.env.SYM_KEY;
  if (!SYM_KEY) {
    throw new Error('No symmetric key found');
  }

  const pluginsRes = plugins?.map((x) => {
    const pluginInstance = getPlugin(x.id);
    const pluginDetails = getPluginParamsAndState(x.id, plugins ?? []);
    if (!pluginDetails) {
      throw new Error('No plugin details found');
    }

    return {
      id: x.id,
      publicParams: x.publicParams,
      privateParams: pluginInstance.encryptPrivateParams(pluginDetails.privateParams)
    };
  });

  return pluginsRes;
};
