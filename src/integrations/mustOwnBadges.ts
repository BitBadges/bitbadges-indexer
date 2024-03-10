import { BigIntify, BlockinAndGroup, BlockinAssetConditionGroup, BlockinOrGroup, NumberType, OwnershipRequirements } from 'bitbadgesjs-sdk';
import { AndGroup, OrGroup } from 'blockin';
import { BackendIntegrationPlugin } from './types';
import { verifyBitBadgesAssets } from '../blockin/verifyBitBadgesAssets';

export const MustOwnPluginDetails: BackendIntegrationPlugin<NumberType, 'mustOwnBadges'> = {
  id: 'mustOwnBadges',
  metadata: {
    name: 'Ownership Requirements',
    description: 'Which badges / lists must the user own / be on to claim this badge?',
    image: 'https://bitbadges.s3.amazonaws.com/greater_than_x_badge_balance.png',
    createdBy: 'BitBadges',
    stateless: true,
    scoped: true
  },
  defaultState: {},
  validateFunction: async (context, publicParams, privateParams, customBody, priorState) => {
    const ownershipRequirementsBase = publicParams.ownershipRequirements || privateParams.ownershipRequirements;
    if (!ownershipRequirementsBase) {
      return { success: false, error: 'No ownership requirements found' };
    }

    let ownershipRequirements: BlockinAssetConditionGroup<bigint> | undefined = undefined;
    if ((ownershipRequirementsBase as AndGroup<NumberType>)['$and']) {
      ownershipRequirements = new BlockinAndGroup(ownershipRequirementsBase as AndGroup<NumberType>).convert(BigIntify) as BlockinAndGroup<bigint>;
    } else if ((ownershipRequirementsBase as OrGroup<NumberType>)['$or']) {
      ownershipRequirements = new BlockinOrGroup(ownershipRequirementsBase as OrGroup<NumberType>).convert(BigIntify) as BlockinOrGroup<bigint>;
    } else {
      ownershipRequirements = new OwnershipRequirements(ownershipRequirementsBase as OwnershipRequirements<NumberType>).convert(
        BigIntify
      ) as OwnershipRequirements<bigint>;
    }

    try {
      console.log(context.cosmosAddress)
      await verifyBitBadgesAssets(ownershipRequirements, context.cosmosAddress);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
  getPublicState: (currState) => {
    return {};
  },
  encryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  decryptPrivateParams: (privateParams) => {
    return privateParams;
  },
  getBlankPublicState: () => {
    return {};
  }
};
